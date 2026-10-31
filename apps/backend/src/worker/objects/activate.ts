/**
 * The activation every object kind shares, in alchemy's two phases: the outer effect binds what
 * the object reaches (it also runs at plan time, against a mock state); the inner one runs per
 * in-memory instance and builds the `ObjectRuntime` over `ctx.storage`.
 *
 * The instance's id is not known here (see `./meta.ts`): it arrives with the first call.
 */
import * as SqliteDo from "@effect/sql-sqlite-do/SqliteClient"
import { bindBotGateways } from "@hazel/bot-gateway/object"
import type { SyncObjectState, SyncSocket } from "@hazel/sync-do"
import { toHttpServerResponse } from "@hazel/sync-do"
import { workerEnvLayer } from "@hazel/infra/worker-runtime"
import * as Cloudflare from "alchemy/Cloudflare"
import { RuntimeContext } from "alchemy/RuntimeContext"
import { Cause, Effect, Exit, Layer, Scope } from "effect"
import { FetchHttpClient, HttpServerRequest, HttpServerResponse } from "effect/http"
import { BotGatewayTransport } from "../../services/bot-gateway-transport"
import { Directory } from "../../services/directory"
import { HtmlRenders } from "../../services/html-renders"
import { ThreadNamer } from "../../services/thread-namer"
import { ChatSyncTransport } from "../../services/chat-sync/chat-sync-transport"
import { directoryBinding, htmlRenderStoreLive, servicesPlatformLive } from "../platform"
import { objectHandlersLive } from "./handlers"
import type { ObjectKind } from "./kinds"
import type { CallRequest } from "./calls"
import type { ApplyEffectRequest } from "./effects/registry"
import { WARM_HEADER } from "./principal"
import type { InvokeRequest } from "./protocol"
import { makeObjectRuntime } from "./runtime"
import { makeSocketTokenVerifier } from "./socket-token"
import { workerObjectStubs } from "./stubs"

export const activateObject = (kind: ObjectKind) =>
	Effect.gen(function* () {
		const state = yield* Cloudflare.DurableObjectState
		const env = yield* Cloudflare.WorkerEnvironment
		// Cross-script binding to the bot gateway's Durable Objects (bots get channel events).
		const botGateways = yield* bindBotGateways

		return Effect.gen(function* () {
			// Built on the first `Reauth`, then reused by the instance.
			const socketTokens = yield* Effect.cached(
				makeSocketTokenVerifier.pipe(Effect.provide(workerEnvLayer(env))),
			)
			const raw = state.raw
			const storage = raw.storage
			const services = servicesPlatformLive(env, botGateways)
			// The constructor's scope closes once it returns; the dispatcher's server fibers must live
			// as long as the in-memory instance, so they get a scope of their own, closed only if
			// construction fails.
			const instanceScope = Scope.makeUnsafe()
			const object = yield* makeObjectRuntime({
				kind,
				storage: storage as never,
				state: raw as unknown as SyncObjectState,
				sql: SqliteDo.layer({ storage: storage as never }),
				// A missing required env var (the layer's `ConfigError`) is a defect.
				handlers: objectHandlersLive.pipe(
					Layer.provide(Layer.mergeAll(services, FetchHttpClient.layer)),
					Layer.orDie,
				),
				socketTokens,
				platform: Layer.mergeAll(
					workerObjectStubs(env),
					Layer.suspend(() => Directory.layerD1(directoryBinding(env))),
					BotGatewayTransport.layerDurableObject(botGateways),
					ThreadNamer.layer.pipe(
						Layer.provide(Layer.mergeAll(FetchHttpClient.layer, workerEnvLayer(env))),
					),
					ChatSyncTransport.layer.pipe(Layer.provide(workerEnvLayer(env)), Layer.orDie),
					HtmlRenders.layer.pipe(
						Layer.provide(Layer.mergeAll(workerEnvLayer(env), htmlRenderStoreLive(env))),
						Layer.orDie,
					),
				),
			}).pipe(
				Effect.provideService(Scope.Scope, instanceScope),
				// A failed construction leaves no instance to own the scope: release what it built.
				Effect.onError((cause) => Scope.close(instanceScope, Exit.failCause(cause))),
			)

			const fetch = Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				// Reaching here means the instance is built: a warm-up needs nothing else.
				if (request.headers[WARM_HEADER] !== undefined)
					return HttpServerResponse.empty({ status: 204 })
				if (request.headers.upgrade?.toLowerCase() !== "websocket") {
					return HttpServerResponse.text("Expected a WebSocket upgrade", { status: 426 })
				}
				const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
				return toHttpServerResponse(yield* object.connect(web))
			})

			/** The RPC bridge reports only "an unexpected cause" to the caller, so log it here. */
			const logFailure =
				(method: string) =>
				<A, E, R>(effect: Effect.Effect<A, E, R>) =>
					effect.pipe(
						Effect.tapCause((cause) =>
							Effect.logError(`${kind} object ${method} failed`, Cause.pretty(cause)),
						),
					)

			return {
				invoke: (request: InvokeRequest) => object.invoke(request).pipe(logFailure("invoke")),
				applyEffect: (request: ApplyEffectRequest) =>
					object.applyEffect(request).pipe(logFailure("applyEffect")),
				call: (request: CallRequest) => object.call(request).pipe(logFailure("call")),
				fetch,
				webSocketMessage: (socket: Cloudflare.WebSocket, message: string | ArrayBuffer) =>
					object.onMessage(socket.ws as unknown as SyncSocket, message),
				webSocketClose: (socket: Cloudflare.WebSocket) =>
					object.onClose(socket.ws as unknown as SyncSocket),
				// An errored socket is gone too: run the close path so presence goes offline.
				webSocketError: (socket: Cloudflare.WebSocket, error: unknown) =>
					Effect.logWarning(`${kind} object socket errored`, error).pipe(
						Effect.andThen(object.onClose(socket.ws as unknown as SyncSocket)),
					),
				alarm: () => object.alarm.pipe(logFailure("alarm"), Effect.provide(RuntimeContext.phantom)),
			}
		})
	})
