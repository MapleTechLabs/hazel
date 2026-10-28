/**
 * `GET /live/:messageId?channelId=<id>`: a message's live state socket (`worker/live/`). Auth as
 * for `/sync` (`./sync-route.ts`): the token rides in `Sec-WebSocket-Protocol` (`hazel.v1,
 * <token>`), a bad one closes with 4001. The upgrade is forwarded to the message's
 * `MessageLiveObject` with the principal, the message id and its host channel (a Connect mount
 * resolves to its host); the object asks the channel whether the user reads it.
 */
import { SyncCloseCode } from "@hazel/domain/sync"
import { ChannelId, MessageId } from "@hazel/schema"
import { toHttpServerResponse } from "@hazel/sync-do"
import { Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Directory } from "../services/directory"
import { HazelSession } from "../services/hazel-session"
import { MESSAGE_LIVE_NAMESPACE } from "./live/message-live-object"
import { LIVE_CHANNEL_HEADER } from "./live/runtime"
import { encodeSyncPrincipal, OBJECT_ID_HEADER, PRINCIPAL_HEADER } from "./objects/principal"
import {
	acceptAndClose,
	pathOf,
	syncObjectId,
	tokenFromProtocols,
	UNAVAILABLE,
	verifySocketToken,
} from "./sync-route"

interface Namespace {
	getByName(name: string): { fetch(request: Request): Promise<Response> }
}

class LiveForwardError extends Schema.TaggedError<LiveForwardError>()("LiveForwardError", {
	messageId: Schema.String,
	cause: Schema.Unknown,
}) {}

const LIVE_PATH = /^\/live\/([^/?]+)$/
const decodeMessageId = Schema.decodeUnknownOption(MessageId)
const decodeChannelId = Schema.decodeUnknownOption(ChannelId)

const channelParam = (url: string) => {
	const query = url.indexOf("?")
	if (query === -1) return null
	return new URLSearchParams(url.slice(query + 1)).get("channelId")
}

export const makeLiveRoute = (env: Record<string, unknown>) =>
	HttpRouter.use((router) =>
		Effect.gen(function* () {
			// Resolved when the route is built: a handler only sees the request's own services.
			const session = yield* HazelSession
			const directory = yield* Directory
			return yield* router.add(
				"GET",
				"/live/*",
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const messageId = decodeMessageId(LIVE_PATH.exec(pathOf(request.url))?.[1])
					const channelId = decodeChannelId(channelParam(request.url))
					if (Option.isNone(messageId) || Option.isNone(channelId)) {
						return HttpServerResponse.text("Not found", { status: 404 })
					}
					if (request.headers.upgrade?.toLowerCase() !== "websocket") {
						return HttpServerResponse.text("Expected a WebSocket upgrade", { status: 426 })
					}
					const token = tokenFromProtocols(request.headers["sec-websocket-protocol"])
					if (token === undefined) return acceptAndClose(SyncCloseCode.Reauth, "missing_token")
					const verified = yield* verifySocketToken(session, token)
					if (verified._tag === "Unavailable") return acceptAndClose(UNAVAILABLE, "unavailable")
					if (Option.isNone(verified.user))
						return acceptAndClose(SyncCloseCode.Reauth, "invalid_token")
					const { user, expiresAt } = verified.user.value

					const hostChannelId = yield* syncObjectId("channel", channelId.value).pipe(
						Effect.provideService(Directory, directory),
						Effect.map(Option.some),
						Effect.catchTag("DatabaseError", (error) =>
							Effect.logError("Live route could not resolve the channel", {
								channelId: channelId.value,
								error: error.message,
							}).pipe(Effect.as(Option.none<string>())),
						),
					)
					if (Option.isNone(hostChannelId)) return acceptAndClose(UNAVAILABLE, "unavailable")

					const namespace = env[MESSAGE_LIVE_NAMESPACE] as Namespace | undefined
					if (namespace === undefined || typeof namespace.getByName !== "function") {
						yield* Effect.logError("Live route: MessageLiveObject is not bound")
						return acceptAndClose(UNAVAILABLE, "unavailable")
					}
					const web = yield* HttpServerRequest.toWeb(request).pipe(
						Effect.map(Option.some),
						Effect.catch((error) =>
							Effect.logWarning("Live upgrade request unreadable", { error: error._tag }).pipe(
								Effect.as(Option.none<Request>()),
							),
						),
					)
					if (Option.isNone(web)) return acceptAndClose(UNAVAILABLE, "unavailable")
					const headers = new Headers(web.value.headers)
					headers.set(PRINCIPAL_HEADER, encodeSyncPrincipal({ userId: user.id, expiresAt }))
					headers.set(OBJECT_ID_HEADER, messageId.value)
					headers.set(LIVE_CHANNEL_HEADER, hostChannelId.value)
					const forwarded = new Request(web.value, { headers })
					return yield* Effect.tryPromise({
						try: () => namespace.getByName(messageId.value).fetch(forwarded),
						catch: (cause) => new LiveForwardError({ messageId: messageId.value, cause }),
					}).pipe(
						Effect.map(toHttpServerResponse),
						Effect.withSpan("LiveRoute.forward", {
							kind: "client",
							attributes: { "message.id": messageId.value },
						}),
						Effect.catchTag("LiveForwardError", (error) =>
							Effect.logError("Live upgrade could not reach the object", {
								messageId: error.messageId,
								cause: String(error.cause),
							}).pipe(Effect.as(acceptAndClose(UNAVAILABLE, "unavailable"))),
						),
					)
				}).pipe(Effect.withSpan("LiveRoute.upgrade")),
			)
		}),
	)
