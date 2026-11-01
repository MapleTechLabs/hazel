/**
 * `MessageLiveObject`: one per message (DO name = message id), the live state of a streamed reply
 * (`./runtime.ts`). Hosted by the api Worker; reached through the env (`liveObjectStubs`) by the
 * HTTP API's writes and reads, and by `/live/:messageId` (`../live-route.ts`) for sockets.
 */
import type { MessageId } from "@hazel/schema"
import type { SyncObjectState, SyncSocket } from "@hazel/sync-do"
import { toHttpServerResponse } from "@hazel/sync-do"
import * as Cloudflare from "@alchemy.run/cloudflare"
import { RuntimeContext } from "alchemy/RuntimeContext"
import { Cause, Effect, Layer } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { workerObjectStubs } from "../objects/stubs"
import {
	LiveObjectStubs,
	type LiveStorage,
	liveRpcOf,
	makeMessageLiveRuntime,
	type MessageLiveRpc,
} from "./runtime"

export const MESSAGE_LIVE_NAMESPACE = "MessageLiveObject"

export class MessageLiveObject extends Cloudflare.DurableObject<MessageLiveObject, MessageLiveRpc>()(
	MESSAGE_LIVE_NAMESPACE,
) {}

export const MessageLiveObjectLive = MessageLiveObject.make(
	Effect.gen(function* () {
		const state = yield* Cloudflare.DurableObjectState
		const env = yield* Cloudflare.WorkerEnvironment
		return Effect.gen(function* () {
			const raw = state.raw
			// No long-lived fibers: the runtime holds plain state, so the constructor's scope suffices.
			const runtime = yield* makeMessageLiveRuntime({
				storage: raw.storage as unknown as LiveStorage,
				state: raw as unknown as SyncObjectState,
			}).pipe(Effect.provide(workerObjectStubs(env)))
			const rpc = liveRpcOf(runtime)

			const logged =
				(method: string) =>
				<A, E, R>(effect: Effect.Effect<A, E, R>) =>
					effect.pipe(
						Effect.tapCause((cause) =>
							Effect.logError(`MessageLiveObject ${method} failed`, Cause.pretty(cause)),
						),
					)

			const fetch = Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				if (request.headers.upgrade?.toLowerCase() !== "websocket") {
					return HttpServerResponse.text("Expected a WebSocket upgrade", { status: 426 })
				}
				const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
				return toHttpServerResponse(yield* runtime.connect(web))
			})

			return {
				write: (request: unknown) => rpc.write(request).pipe(logged("write")),
				read: (request: unknown) => rpc.read(request).pipe(logged("read")),
				fetch,
				webSocketMessage: (socket: Cloudflare.WebSocket, message: string | ArrayBuffer) =>
					runtime.onMessage(socket.ws as unknown as SyncSocket, message),
				webSocketClose: (socket: Cloudflare.WebSocket) =>
					runtime.onClose(socket.ws as unknown as SyncSocket),
				webSocketError: (socket: Cloudflare.WebSocket, error: unknown) =>
					Effect.logWarning("MessageLiveObject socket errored", error).pipe(
						Effect.andThen(runtime.onClose(socket.ws as unknown as SyncSocket)),
					),
				alarm: () => runtime.alarm.pipe(logged("alarm"), Effect.provide(RuntimeContext.phantom)),
			}
		})
	}),
)

interface Namespace {
	getByName(name: string): unknown
}

/** `LiveObjectStubs` over the api Worker's `MessageLiveObject` namespace. */
export const workerLiveObjectStubs = (env: Record<string, unknown>): Layer.Layer<LiveObjectStubs> =>
	Layer.sync(LiveObjectStubs, () => ({
		get: (messageId: MessageId) => {
			const namespace = env[MESSAGE_LIVE_NAMESPACE] as Namespace | undefined
			if (namespace === undefined)
				throw new Error(`${MESSAGE_LIVE_NAMESPACE} is not bound on this Worker`)
			const stub = Cloudflare.makeRpcStub<MessageLiveRpc>(
				namespace.getByName(messageId),
			) as unknown as {
				readonly write: (request: unknown) => Effect.Effect<{ readonly exit: unknown }, unknown>
				readonly read: (request: unknown) => Effect.Effect<{ readonly exit: unknown }, unknown>
			}
			return stub
		},
	}))
