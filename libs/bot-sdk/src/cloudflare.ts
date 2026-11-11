/**
 * Running a bot on Cloudflare: inside a Durable Object, the one Workers primitive that can hold
 * the outbound gateway WebSocket open and keep fibers running between requests.
 *
 * - {@link makeBotSupervisor} starts the bot ({@link launchBot}) in the object and keeps it up:
 *   `ensureRunning` starts it unless it runs, and re-arms a watchdog alarm, so call it from the
 *   object's `alarm()` and from a per-minute cron on the host Worker (which also brings it back
 *   after a deploy or an eviction).
 * - The resume offset and bot state live in the object's storage ({@link durableObjectStores}),
 *   so a restarted bot resumes where it left off instead of tailing from "now".
 *
 * The bot runs in the caller's Effect context: provide the Worker env as the `ConfigProvider`
 * (`BOT_TOKEN`, `BACKEND_URL`, `GATEWAY_URL`, plus what the bot reads), and the host's logger
 * and tracer. Nothing here depends on a Cloudflare package; the storage is typed structurally.
 */
import type { BotId } from "@hazel/schema"
import { Effect, Ref, type Scope } from "effect"
import type { CommandGroup, EmptyCommands } from "./command.ts"
import { GatewaySessionStoreError } from "./errors.ts"
import type { BotStateStore, GatewaySessionStore } from "./gateway.ts"
import { launchBot } from "./run-bot.ts"
import type { BotDefinition } from "./runtime.ts"

/** The subset of a Durable Object's `ctx.storage` the host uses. */
export interface DurableObjectStorageLike {
	get<T = unknown>(key: string): Promise<T | undefined>
	put<T>(key: string, value: T): Promise<void>
	delete(key: string): Promise<boolean>
	setAlarm(scheduledTime: number): Promise<void>
}

const storageCall = <A>(message: string, call: () => Promise<A>) =>
	Effect.tryPromise({ try: call, catch: (cause) => new GatewaySessionStoreError({ message, cause }) })

/** The gateway session and bot state stores over a Durable Object's storage. */
export const durableObjectStores = (
	storage: DurableObjectStorageLike,
): { readonly sessionStore: GatewaySessionStore; readonly stateStore: BotStateStore } => {
	const offsetKey = (botId: BotId) => `gateway-offset:${botId}`
	const stateKey = (botId: BotId, key: string) => `state:${botId}:${key}`
	return {
		sessionStore: {
			load: (botId) =>
				storageCall(`Failed to load resume offset for bot ${botId}`, () =>
					storage.get<string>(offsetKey(botId)),
				).pipe(Effect.map((offset) => offset ?? null)),
			save: (botId, offset) =>
				storageCall(`Failed to save resume offset for bot ${botId}`, () =>
					storage.put(offsetKey(botId), offset),
				),
		},
		stateStore: {
			get: (botId, key) =>
				storageCall(`Failed to read bot state for bot ${botId} and key ${key}`, () =>
					storage.get<string>(stateKey(botId, key)),
				).pipe(Effect.map((value) => value ?? null)),
			set: (botId, key, value) =>
				storageCall(`Failed to persist bot state for bot ${botId} and key ${key}`, () =>
					storage.put(stateKey(botId, key), value),
				),
			delete: (botId, key) =>
				storageCall(`Failed to delete bot state for bot ${botId} and key ${key}`, () =>
					storage.delete(stateKey(botId, key)),
				).pipe(Effect.asVoid),
		},
	}
}

export interface BotSupervisorOptions {
	/** The object's storage: the stores, and the watchdog alarm. */
	readonly storage: DurableObjectStorageLike
	/** How often the alarm checks on the bot. @default 30 seconds */
	readonly watchdogIntervalMs?: number
}

export interface BotSupervisor {
	/**
	 * Start the bot unless it runs, and re-arm the watchdog alarm. `wasRunning` is whether the bot
	 * was already up: `false` means it had stopped (or never started) and was just started, so a
	 * health check should report it as down.
	 */
	readonly ensureRunning: Effect.Effect<{ readonly wasRunning: boolean }>
}

/**
 * Supervise a bot in a Durable Object. Build it once per object instance, in the instance's
 * scope: the bot's fiber lives as long as the scope. A bot that fails (a bad token, an
 * unreachable backend) is logged and restarted on the next alarm or cron call.
 */
export const makeBotSupervisor = <Commands extends CommandGroup<any> = EmptyCommands>(
	bot: BotDefinition<Commands>,
	options: BotSupervisorOptions,
): Effect.Effect<BotSupervisor, never, Scope.Scope> =>
	Effect.gen(function* () {
		const scope = yield* Effect.scope
		const running = yield* Ref.make(false)
		const stores = durableObjectStores(options.storage)
		const watchdogIntervalMs = options.watchdogIntervalMs ?? 30_000

		const run = launchBot({ ...bot, config: stores }).pipe(
			Effect.tapCause((cause) => Effect.logError("Bot stopped, restarting on the next check", cause)),
			Effect.ensuring(Ref.set(running, false)),
		)

		const ensureRunning = Effect.gen(function* () {
			const wasRunning = yield* Ref.getAndSet(running, true)
			if (!wasRunning) {
				yield* Effect.forkIn(run, scope)
			}
			yield* Effect.tryPromise(() => options.storage.setAlarm(Date.now() + watchdogIntervalMs)).pipe(
				Effect.catch((error) => Effect.logWarning("Failed to arm the bot watchdog alarm", { error })),
			)
			return { wasRunning }
		})

		return { ensureRunning }
	})
