/**
 * The Linear bot on Cloudflare: a Worker hosting the `LinearBotRunner` Durable Object, which runs the
 * bot (`./bot.ts`) and holds its gateway WebSocket. A per-minute cron (and `GET /health`) calls
 * `ensureRunning`, which starts the bot after a deploy or an eviction; while it runs, the
 * object's watchdog alarm keeps it warm (`@hazel-chat/bot-sdk/cloudflare`).
 */
import { makeBotSupervisor } from "@hazel-chat/bot-sdk/cloudflare"
import { botWorkerProps, HazelStack } from "@hazel/infra/cloudflare"
import { requireSecretEntry } from "@hazel/infra/env"
import { hazelTelemetry } from "@hazel/infra/maple"
import { workerEnvLayer } from "@hazel/infra/worker-runtime"
import * as Cloudflare from "@alchemy.run/cloudflare"
import { Effect, Layer } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { bot } from "./bot.ts"

export const LINEAR_BOT_APP = "linear-bot"

/** The stack env key holding the bot's token (its `BOT_TOKEN`). */
export const LINEAR_BOT_TOKEN_KEY = "LINEAR_BOT_TOKEN"

export interface BotRunnerShape {
	/** Start the bot unless it runs; `wasRunning` is whether it already ran. */
	readonly ensureRunning: () => Effect.Effect<{ readonly wasRunning: boolean }>
}

export class LinearBotRunner extends Cloudflare.DurableObject<LinearBotRunner, BotRunnerShape>()(
	"LinearBotRunner",
) {}

/** The one runner: the gateway admits a single session per bot. */
const RUNNER_NAME = "bot"

const LinearBotRunnerLive = LinearBotRunner.make(
	Effect.gen(function* () {
		const state = yield* Cloudflare.DurableObjectState
		const env = yield* Cloudflare.WorkerEnvironment
		return Effect.gen(function* () {
			const supervisor = yield* makeBotSupervisor(bot, { storage: state.raw.storage })
			// The bot's fiber inherits this context: its env is read through the `ConfigProvider`.
			const ensureRunning = supervisor.ensureRunning.pipe(Effect.provide(workerEnvLayer(env)))
			return {
				ensureRunning: () => ensureRunning,
				alarm: () => Effect.asVoid(ensureRunning),
			}
		})
	}),
)

/** `__ALCHEMY_RUNTIME__` folds to `true` in the bundle, so the stack-side branch is tree-shaken. */
const props = Effect.gen(function* () {
	if (globalThis.__ALCHEMY_RUNTIME__) return { main: import.meta.url }
	const stack = yield* HazelStack
	return {
		main: import.meta.url,
		...(yield* botWorkerProps(LINEAR_BOT_APP, stack, {
			tokenKey: LINEAR_BOT_TOKEN_KEY,
			env: requireSecretEntry("OPENROUTER_API_KEY"),
		})),
	}
})

export class LinearBotWorker extends Cloudflare.Worker<
	LinearBotWorker,
	Cloudflare.WorkerShape,
	LinearBotRunner
>()(LINEAR_BOT_APP) {}

export default LinearBotWorker.make(
	props,
	Effect.gen(function* () {
		// Yielding the hosted DO binds, registers and exports it.
		const runners = yield* LinearBotRunner
		const ensureRunning = () => runners.getByName(RUNNER_NAME).ensureRunning()

		yield* Cloudflare.Workers.cron("* * * * *", ensureRunning)

		return {
			fetch: Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				if (request.method === "GET" && new URL(request.url, "http://bot").pathname === "/health") {
					// 503 when the bot had stopped (it restarts now), so a crash-looping bot reads as down.
					const { wasRunning } = yield* ensureRunning()
					return HttpServerResponse.jsonUnsafe(
						{ running: wasRunning },
						{ status: wasRunning ? 200 : 503 },
					)
				}
				return HttpServerResponse.text("Not found", { status: 404 })
			}),
		}
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				LinearBotRunnerLive,
				Cloudflare.Workers.CronEventSourceLive,
				hazelTelemetry(LINEAR_BOT_APP),
			),
		),
	),
)
