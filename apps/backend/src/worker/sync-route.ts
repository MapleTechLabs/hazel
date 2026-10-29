/**
 * `GET /sync/:kind/:id`: the sync WebSocket (`infra/durable-object-sync-plan.md` §3 Auth).
 *
 * The client offers `Sec-WebSocket-Protocol: hazel.v1, <token>` (browsers cannot set an
 * Authorization header on a WebSocket): the access token from `POST /auth/token`, or a session
 * credential, verified the way the api verifies a bearer session; the upgrade is then forwarded to the object with the principal and the object's id as
 * headers (objects are reachable only through bindings, so they trust them). The object
 * authorizes the principal against its own tables.
 *
 * A bad token is answered by accepting the socket and closing it with 4001 (`Reauth`): a browser
 * cannot read the HTTP status of a refused upgrade. The principal carries the credential's expiry
 * (the access token's `exp`, or the session's), at which the object closes the socket with 4001
 * unless the client sent a fresh token in band first (`Reauth`, `./objects/socket-token.ts`).
 * A failure that is not the token's (the session store, the directory, the object) closes with
 * 1011, which the client retries without dropping its token.
 *
 * A Connect guest's mounted channel streams from its host channel's object (`channel_index`).
 */
import { SYNC_SUBPROTOCOL, SyncCloseCode } from "@hazel/domain/sync"
import { toHttpServerResponse } from "@hazel/sync-do"
import { type Context, Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HazelSession } from "../services/hazel-session"
import { ChannelId } from "@hazel/schema"
import { Directory } from "../services/directory"
import { isObjectKind, OBJECT_NAMESPACES, type ObjectKind } from "./objects/kinds"
import { encodeSyncPrincipal, OBJECT_ID_HEADER, PRINCIPAL_HEADER } from "./objects/principal"

interface WorkerdSocket {
	accept(): void
	close(code?: number, reason?: string): void
}

interface Namespace {
	getByName(name: string): { fetch(request: Request): Promise<Response> }
}

const decodeChannelId = Schema.decodeUnknownOption(ChannelId)

/** Closed with this when the route cannot serve the socket right now; the client retries. */
export const UNAVAILABLE = 1011

/** The object's `fetch` failed (overloaded, reset, unreachable). */
class SyncForwardError extends Schema.TaggedError<SyncForwardError>()("SyncForwardError", {
	objectId: Schema.String,
	cause: Schema.Unknown,
}) {}

const SYNC_PATH = /^\/sync\/(org|channel|user)\/([^/?]+)/

/** `hazel.v1, <token>` → the token. */
export const tokenFromProtocols = (header: string | undefined): string | undefined => {
	const offered = (header ?? "").split(",").map((entry) => entry.trim())
	if (offered[0] !== SYNC_SUBPROTOCOL) return undefined
	const token = offered[1]
	return token === undefined || token.length === 0 ? undefined : token
}

const isJwt = (token: string) => token.split(".").length === 3

/** A 101 whose socket is closed right away with `code`, so the browser sees the reason. */
export const acceptAndClose = (code: number, reason: string) => {
	const Pair = (globalThis as unknown as { WebSocketPair: new () => Record<0 | 1, WorkerdSocket> })
		.WebSocketPair
	const pair = new Pair()
	pair[1].accept()
	pair[1].close(code, reason)
	return toHttpServerResponse(
		new Response(null, {
			status: 101,
			webSocket: pair[0],
			headers: { "Sec-WebSocket-Protocol": SYNC_SUBPROTOCOL },
		} as unknown as ResponseInit),
	)
}

/** The object a sync socket for `kind`/`id` opens: a Connect guest mount's host channel. */
export const syncObjectId = (kind: ObjectKind, id: string) => {
	const channelId = kind === "channel" ? decodeChannelId(id) : Option.none()
	if (Option.isNone(channelId)) return Effect.succeed(id)
	return Effect.flatMap(Directory, (directory) => directory.channel(channelId.value)).pipe(
		Effect.map(Option.match({ onNone: () => id, onSome: (row) => row.hostChannelId ?? id })),
		Effect.withSpan("SyncRoute.resolveObject", { attributes: { "channel.id": id } }),
	)
}

/**
 * A socket's token: the web app sends its access token (a JWT); native clients may send the
 * session itself. `Unavailable` when the session store or the key set is down: not the token's
 * fault, so no 4001 (the client would drop a good token); it retries on 1011.
 */
export const verifySocketToken = (session: Context.Service.Shape<typeof HazelSession>, token: string) =>
	(isJwt(token) ? session.verifyAccessTokenWithExpiry : session.verifyWithExpiry)(token).pipe(
		Effect.map((user) => ({ _tag: "Checked", user }) as const),
		Effect.catchTags({
			InvalidBearerTokenError: () => Effect.succeed({ _tag: "Checked", user: Option.none() } as const),
			SessionLoadError: (error) =>
				Effect.logWarning("Socket token verification unavailable", { detail: error.detail }).pipe(
					Effect.as({ _tag: "Unavailable" } as const),
				),
		}),
	)

export const pathOf = (url: string) => {
	const path = url.startsWith("/") ? url : new URL(url).pathname
	const query = path.indexOf("?")
	return query === -1 ? path : path.slice(0, query)
}

export const makeSyncRoute = (env: Record<string, unknown>) =>
	HttpRouter.use((router) =>
		Effect.gen(function* () {
			// Resolved when the route is built: a handler only sees the request's own services.
			const session = yield* HazelSession
			const directory = yield* Directory
			return yield* router.add(
				"GET",
				"/sync/*",
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const match = SYNC_PATH.exec(pathOf(request.url))
					const kind = match?.[1]
					const id = match?.[2]
					if (kind === undefined || id === undefined || !isObjectKind(kind)) {
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

					const objectId = yield* syncObjectId(kind, id).pipe(
						Effect.provideService(Directory, directory),
						Effect.map(Option.some),
						Effect.catchTag("DatabaseError", (error) =>
							Effect.logError("Sync route could not resolve the object", {
								kind,
								id,
								error: error.message,
							}).pipe(Effect.as(Option.none<string>())),
						),
					)
					if (Option.isNone(objectId)) return acceptAndClose(UNAVAILABLE, "unavailable")

					const namespace = env[OBJECT_NAMESPACES[kind]] as Namespace | undefined
					if (namespace === undefined || typeof namespace.getByName !== "function") {
						yield* Effect.logError("Sync route: object namespace is not bound", {
							namespace: OBJECT_NAMESPACES[kind],
						})
						return acceptAndClose(UNAVAILABLE, "unavailable")
					}
					const web = yield* HttpServerRequest.toWeb(request).pipe(
						Effect.map(Option.some),
						// `RequestError`: the upgrade request itself could not be converted.
						Effect.catch((error) =>
							Effect.logWarning("Sync upgrade request unreadable", { error: error._tag }).pipe(
								Effect.as(Option.none<Request>()),
							),
						),
					)
					if (Option.isNone(web)) return acceptAndClose(UNAVAILABLE, "unavailable")
					const headers = new Headers(web.value.headers)
					// The object closes the socket with 4001 at `expiresAt`; the client reconnects with
					// a fresh token.
					headers.set(PRINCIPAL_HEADER, encodeSyncPrincipal({ userId: user.id, expiresAt }))
					headers.set(OBJECT_ID_HEADER, objectId.value)
					const forwarded = new Request(web.value, { headers })
					return yield* Effect.tryPromise({
						try: () => namespace.getByName(objectId.value).fetch(forwarded),
						catch: (cause) => new SyncForwardError({ objectId: objectId.value, cause }),
					}).pipe(
						Effect.map(toHttpServerResponse),
						Effect.withSpan("SyncRoute.forward", {
							kind: "client",
							attributes: { "object.kind": kind, "object.id": objectId.value },
						}),
						Effect.catchTag("SyncForwardError", (error) =>
							Effect.logError("Sync upgrade could not reach the object", {
								objectId: error.objectId,
								cause: String(error.cause),
							}).pipe(Effect.as(acceptAndClose(UNAVAILABLE, "unavailable"))),
						),
					)
				}).pipe(Effect.withSpan("SyncRoute.upgrade")),
			)
		}),
	)
