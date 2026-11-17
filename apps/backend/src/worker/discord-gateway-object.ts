/**
 * The Discord gateway session on Cloudflare: a singleton Durable Object holding the outbound
 * gateway WebSocket.
 *
 * `ensureRunning()` starts the session if this instance isn't running one. The api Worker calls it
 * from a per-minute cron, which also restarts the session after a deploy or an eviction; while a
 * session runs, an alarm every 30s keeps the object warm and restarts a session that ended.
 *
 * Events are routed through the directory's `chat_sync_index` to the `OrgObject`s
 * (`services/chat-sync/providers/discord/gateway-service.ts`).
 */
import * as Cloudflare from "@alchemy.run/cloudflare"
import { RuntimeContext } from "alchemy/RuntimeContext"
import { Context, Effect, Layer, Option, Ref, Scope } from "effect"
import * as Socket from "effect/socket/Socket"
import { workerEnvLayer } from "@hazel/infra/worker-runtime"
import { Directory } from "../services/directory"
import { workerObjectStubs } from "./objects/stubs"
import { directoryBinding } from "./platform"

export interface DiscordGatewayShape {
	/** Start the gateway session unless one is running; reports whether one runs afterwards. */
	readonly ensureRunning: () => Effect.Effect<{ readonly running: boolean }>
}

export class DiscordGatewayObject extends Cloudflare.DurableObject<
	DiscordGatewayObject,
	DiscordGatewayShape
>()("DiscordGateway") {}

/** The one gateway instance: Discord allows a single session per bot token and shard. */
export const DISCORD_GATEWAY_NAME = "discord"

const WATCHDOG_INTERVAL_MS = 30_000

export const DiscordGatewayObjectLive = DiscordGatewayObject.make(
	Effect.gen(function* () {
		const state = yield* Cloudflare.DurableObjectState
		const env = yield* Cloudflare.WorkerEnvironment
		return Effect.gen(function* () {
			// The session's scope, owned by this in-memory instance and never closed. Not the
			// ambient `Scope`: that is the scope `worker.ts` built this object's layer in, closed
			// once the Worker's init returns. A fiber forked into a closed scope is interrupted
			// before its first step, so the session never connected (and never logged).
			const objectScope = yield* Scope.make()
			// Imported by the instance, not the module: the gateway client (dfx and Discord's API
			// types) would otherwise be evaluated by every cold isolate of the script, the other
			// objects' included, while only this singleton runs it.
			const { DiscordGatewayService } = yield* Effect.promise(
				() => import("../services/chat-sync/providers/discord/gateway-service"),
			)
			const services = yield* Layer.buildWithScope(
				DiscordGatewayService.layer.pipe(
					Layer.provide(
						Layer.mergeAll(
							workerObjectStubs(env),
							Directory.layerD1(directoryBinding(env)),
							workerEnvLayer(env),
						),
					),
					Layer.orDie,
				),
				objectScope,
			)
			const gateway = Context.get(services, DiscordGatewayService)
			const running = yield* Ref.make(false)

			const ensureRunning = Effect.gen(function* () {
				if (Option.isNone(gateway.run)) return { running: false }
				if (!(yield* Ref.getAndSet(running, true))) {
					yield* gateway.run.value.pipe(
						Effect.provide(Socket.layerWebSocketConstructorGlobal),
						// A scope of the session's own: the one in context is this call's, closed
						// as soon as the call returns.
						Effect.scoped,
						Effect.ensuring(Ref.set(running, false)),
						Effect.forkIn(objectScope),
					)
				}
				yield* state.storage.setAlarm(Date.now() + WATCHDOG_INTERVAL_MS)
				return { running: true }
			}).pipe(Effect.provide(RuntimeContext.phantom))

			return {
				ensureRunning: () => ensureRunning,
				alarm: () => Effect.asVoid(ensureRunning),
			}
		})
	}),
)
