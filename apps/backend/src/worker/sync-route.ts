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
 *
 * `GET /sync/mux` carries every source of a client over one socket (`hazel.mux.v1, <token>`): the
 * client opens each source with its own token, and the route opens that object's socket the same
 * way and relays its frames (`@hazel/sync-do` `mux.ts`). A browser opens WebSockets to a host one handshake
 * at a time, so a socket per source costs a load one round of handshakes per source. A token is
 * verified once per socket, not once per source opened with it.
 *
 * `POST /sync/warm?org=<id>&channel=<id>` (each up to 8 times) wakes the objects a load is about
 * to open, so a cold one starts while the web app's script still loads (`index.html`): the
 * caller's `UserObject`, the `OrgObject` of each org they are a member of, and each channel's
 * object when the directory knows it (an unknown id must not create one). The caller is a bearer
 * (access token or session credential) or the browser's session cookie; it answers 204 once they
 * are up, and the page does not wait for it.
 *
 * Every `fetch` into an object carries the forwarding span as `traceparent`, so the object's
 * request span (and its `SyncDO.connect` or `SyncDO.warm`) is that span's child.
 */
import { SYNC_MUX_SUBPROTOCOL, SYNC_SUBPROTOCOL, SyncCloseCode, type SyncMuxOpen } from "@hazel/domain/sync"
import { type MuxOpenResult, refuseMuxStream, startMuxSession, toHttpServerResponse } from "@hazel/sync-do"
import { AccessToken } from "@hazel/auth/server"
import { Clock, type Context, Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse, HttpTraceContext } from "effect/http"
import { HazelSession, type VerifiedUser } from "../services/hazel-session"
import { ChannelId, OrganizationId, type UserId } from "@hazel/schema"
import type { Socket } from "effect/socket"
import { type ChannelIndexRow, Directory } from "../services/directory"
import { isObjectKind, OBJECT_NAMESPACES, type ObjectKind } from "./objects/kinds"
import { encodeSyncPrincipal, OBJECT_ID_HEADER, PRINCIPAL_HEADER, WARM_HEADER } from "./objects/principal"

interface WorkerdSocket {
	accept(): void
	close(code?: number, reason?: string): void
}

interface Namespace {
	getByName(name: string): { fetch(request: Request): Promise<Response> }
}

const decodeChannelId = Schema.decodeUnknownOption(ChannelId)
const decodeOrganizationId = Schema.decodeUnknownOption(OrganizationId)

/** Closed with this when the route cannot serve the socket right now; the client retries. */
export const UNAVAILABLE = 1011

/** `POST /sync/warm` reads this many `org` and `channel` parameters each; the rest are ignored. */
const WARM_IDS_MAX = 8

/**
 * How long a mux socket reuses a verified token: an access token's lifetime. A session credential
 * is valid far longer, and is checked again as often as a token would be re-minted.
 */
const TOKEN_REUSE_MS = AccessToken.lifetimeSeconds * 1000

/** The object's `fetch` failed (overloaded, reset, unreachable). */
class SyncForwardError extends Schema.TaggedError<SyncForwardError>()("SyncForwardError", {
	objectId: Schema.String,
	cause: Schema.Unknown,
}) {}

const SYNC_PATH = /^\/sync\/(org|channel|user|customers)\/([^/?]+)/

/** `<protocol>, <token>` (`hazel.v1`, or `hazel.mux.v1` on `/sync/mux`) → the token. */
export const tokenFromProtocols = (
	header: string | undefined,
	protocol: string = SYNC_SUBPROTOCOL,
): string | undefined => {
	const offered = (header ?? "").split(",").map((entry) => entry.trim())
	if (offered[0] !== protocol) return undefined
	const token = offered[1]
	return token === undefined || token.length === 0 ? undefined : token
}

const isJwt = (token: string) => token.split(".").length === 3

const makePair = () =>
	new (globalThis as unknown as { WebSocketPair: new () => Record<0 | 1, WorkerdSocket> }).WebSocketPair()

/** A 101 whose socket is closed right away with `code`, so the browser sees the reason. */
export const acceptAndClose = (code: number, reason: string, protocol: string = SYNC_SUBPROTOCOL) => {
	const pair = makePair()
	pair[1].accept()
	pair[1].close(code, reason)
	return toHttpServerResponse(
		new Response(null, {
			status: 101,
			webSocket: pair[0],
			headers: { "Sec-WebSocket-Protocol": protocol },
		} as unknown as ResponseInit),
	)
}

/** Where a socket goes once its token checks out, or the close code it gets instead. */
type SocketTarget =
	| { readonly _tag: "Refused"; readonly code: number; readonly reason: string }
	| {
			readonly _tag: "Target"
			readonly userId: UserId
			readonly object: { fetch(request: Request): Promise<Response> }
			/** The principal and object id, which the object trusts (it is reachable only through bindings). */
			readonly headers: { readonly [PRINCIPAL_HEADER]: string; readonly [OBJECT_ID_HEADER]: string }
			readonly span: Record<string, string>
	  }

const refusedTarget = (code: number, reason: string): SocketTarget => ({ _tag: "Refused", code, reason })

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

type SocketTokenCheck = Effect.Success<ReturnType<typeof verifySocketToken>>

/**
 * One mux socket's token checks. A token string is verified once (the session's user is a D1
 * read), then reused by every stream opened with it until it expires or `TOKEN_REUSE_MS` passed;
 * streams opened together with an unseen token share its one check.
 */
const makeSocketTokens = (session: Context.Service.Shape<typeof HazelSession>) => {
	const verified = new Map<string, { readonly user: VerifiedUser; readonly until: number }>()
	const inFlight = new Map<string, Effect.Effect<SocketTokenCheck>>()
	return (token: string): Effect.Effect<SocketTokenCheck> =>
		Effect.gen(function* () {
			const now = yield* Clock.currentTimeMillis
			const known = verified.get(token)
			if (known !== undefined && now < known.until) {
				return { _tag: "Checked", user: Option.some(known.user) } as const
			}
			// Tokens rotate on a long-lived socket: drop the ones that are over.
			for (const [key, entry] of verified) if (now >= entry.until) verified.delete(key)
			const running = inFlight.get(token)
			if (running !== undefined) return yield* running
			const check = yield* Effect.cached(
				verifySocketToken(session, token).pipe(
					Effect.tap((checked) =>
						Effect.sync(() => {
							if (checked._tag !== "Checked" || Option.isNone(checked.user)) return
							const user = checked.user.value
							verified.set(token, {
								user,
								until: Math.min(user.expiresAt, now + TOKEN_REUSE_MS),
							})
						}),
					),
					Effect.ensuring(Effect.sync(() => void inFlight.delete(token))),
				),
			)
			inFlight.set(token, check)
			return yield* check
		})
}

export const pathOf = (url: string) => {
	const path = url.startsWith("/") ? url : new URL(url).pathname
	const query = path.indexOf("?")
	return query === -1 ? path : path.slice(0, query)
}

/** The current span as `traceparent` and `b3` headers; none outside a span. */
const traceHeaders = Effect.currentSpan.pipe(
	Effect.map((span): Record<string, string> => ({ ...HttpTraceContext.toHeaders(span) })),
	Effect.catchTag("NoSuchElementError", () => Effect.succeed<Record<string, string>>({})),
)

/** The first `WARM_IDS_MAX` values that decode, once each. */
const warmIds = <A>(values: ReadonlyArray<string>, decode: (value: string) => Option.Option<A>) => [
	...new Set(values.slice(0, WARM_IDS_MAX).flatMap((value) => Option.toArray(decode(value)))),
]

/** The object `kind`/`name` is up; a failure only means the socket wakes it later. */
const warmObject = (namespace: Namespace, kind: ObjectKind, name: string) =>
	Effect.flatMap(traceHeaders, (trace) =>
		Effect.tryPromise(() =>
			namespace
				.getByName(name)
				.fetch(new Request("https://object/warm", { headers: { ...trace, [WARM_HEADER]: "1" } })),
		),
	).pipe(
		Effect.ignore,
		Effect.withSpan("SyncRoute.warmObject", {
			kind: "client",
			attributes: { "object.kind": kind, "object.id": name },
		}),
	)

export const makeSyncRoute = (env: Record<string, unknown>) =>
	HttpRouter.use((router) =>
		Effect.gen(function* () {
			// Resolved when the route is built: a handler only sees the request's own services.
			const session = yield* HazelSession
			const directory = yield* Directory
			const namespaceOf = (kind: ObjectKind) => {
				const namespace = env[OBJECT_NAMESPACES[kind]] as Namespace | undefined
				return namespace !== undefined && typeof namespace.getByName === "function"
					? namespace
					: undefined
			}

			const wake = (kind: ObjectKind, name: string) => {
				const namespace = namespaceOf(kind)
				return namespace === undefined ? Effect.void : warmObject(namespace, kind, name)
			}

			/**
			 * Who asks for a warm-up, or the status they get instead: a bearer (access token or
			 * session credential), else the browser's session cookie.
			 *
			 * The cookie is taken without the CSRF header the `/auth` routes require, so a page can
			 * send this as a CORS simple request (no preflight) before it has a token: the route
			 * only wakes objects and answers nothing. `fromCookie` still refuses a foreign `Origin`.
			 */
			const warmCaller = (request: HttpServerRequest.HttpServerRequest) =>
				Effect.gen(function* () {
					const refused = (status: 401 | 503) => ({ _tag: "Refused", status }) as const
					const caller = (userId: UserId) => ({ _tag: "Caller", userId }) as const
					const authorization = request.headers.authorization
					const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : ""
					if (token !== "") {
						const verified = yield* verifySocketToken(session, token)
						if (verified._tag === "Unavailable") return refused(503)
						return Option.match(verified.user, {
							onNone: () => refused(401),
							onSome: ({ user }) => caller(user.id),
						})
					}
					return yield* session.fromCookie(request.headers, request.method).pipe(
						Effect.map(
							Option.match({
								onNone: () => refused(401),
								onSome: (user) => caller(user.id),
							}),
						),
						Effect.catchTags({
							InvalidBearerTokenError: () => Effect.succeed(refused(401)),
							SessionLoadError: (error) =>
								Effect.logWarning("Warm-up session check unavailable", {
									detail: error.detail,
								}).pipe(Effect.as(refused(503))),
						}),
					)
				})

			yield* router.add(
				"POST",
				"/sync/warm",
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const caller = yield* warmCaller(request)
					if (caller._tag === "Refused") return HttpServerResponse.empty({ status: caller.status })

					const query = new URL(request.url, "http://localhost").searchParams
					const organizationIds = warmIds(query.getAll("org"), decodeOrganizationId)
					const channelIds = warmIds(query.getAll("channel"), decodeChannelId)
					const each = { concurrency: "unbounded", discard: true } as const
					// The user object wakes while D1 resolves the orgs and the channels.
					yield* Effect.all(
						[
							wake("user", caller.userId),
							// One `membership_index` read for every id: only the caller's own orgs.
							organizationIds.length === 0
								? Effect.void
								: directory.organizationsOf(caller.userId).pipe(
										Effect.catchTag("DatabaseError", () =>
											Effect.succeed<ReadonlyArray<OrganizationId>>([]),
										),
										Effect.flatMap((own) =>
											Effect.forEach(
												organizationIds.filter((id) => own.includes(id)),
												(id) => wake("org", id),
												each,
											),
										),
									),
							Effect.forEach(
								channelIds,
								(id) =>
									directory.channel(id).pipe(
										Effect.catchTag("DatabaseError", () =>
											Effect.succeed(Option.none<ChannelIndexRow>()),
										),
										Effect.flatMap(
											Option.match({
												onNone: () => Effect.void,
												onSome: (row) =>
													row.deletedAt === null
														? wake("channel", row.hostChannelId ?? row.channelId)
														: Effect.void,
											}),
										),
									),
								each,
							),
						],
						each,
					)
					return HttpServerResponse.empty({ status: 204 })
				}).pipe(Effect.withSpan("SyncRoute.warm")),
			)

			/** Whether `userId` is an active member of the org `id` names (`membership_index`). */
			const customersMembership = (userId: UserId, id: string) =>
				Option.match(decodeOrganizationId(id), {
					onNone: () => Effect.succeed(false),
					onSome: (organizationId) =>
						directory.membership(userId, organizationId).pipe(
							Effect.map((row) => Option.isSome(row) && row.value.deletedAt === null),
							Effect.catchTag("DatabaseError", (error) =>
								Effect.logError("Sync route could not check the membership", {
									error: error.message,
								}).pipe(Effect.as("unavailable" as const)),
							),
						),
				})

			/**
			 * The object a socket for `kind`/`id` opens with `token` (checked by `verify`), and the
			 * principal headers it gets; or the close code the client gets instead.
			 */
			const socketTarget = (
				kind: ObjectKind,
				id: string,
				token: string,
				verify: (token: string) => Effect.Effect<SocketTokenCheck>,
			) =>
				Effect.gen(function* () {
					const verified = yield* verify(token)
					if (verified._tag === "Unavailable") return refusedTarget(UNAVAILABLE, "unavailable")
					if (Option.isNone(verified.user))
						return refusedTarget(SyncCloseCode.Reauth, "invalid_token")
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
					if (Option.isNone(objectId)) return refusedTarget(UNAVAILABLE, "unavailable")
					// A customers object exists per org: only its members may wake it (an unknown id
					// must not create one).
					if (kind === "customers") {
						const member = yield* customersMembership(user.id, id)
						if (member === "unavailable") return refusedTarget(UNAVAILABLE, "unavailable")
						if (!member) return refusedTarget(SyncCloseCode.Forbidden, "not_a_member")
					}

					const namespace = namespaceOf(kind)
					if (namespace === undefined) {
						yield* Effect.logError("Sync route: object namespace is not bound", {
							namespace: OBJECT_NAMESPACES[kind],
						})
						return refusedTarget(UNAVAILABLE, "unavailable")
					}
					// The object closes the socket with 4001 at `expiresAt`; the client reconnects with a
					// fresh token (or sends `Reauth` first).
					return {
						_tag: "Target",
						userId: user.id,
						object: namespace.getByName(objectId.value),
						headers: {
							[PRINCIPAL_HEADER]: encodeSyncPrincipal({ userId: user.id, expiresAt }),
							[OBJECT_ID_HEADER]: objectId.value,
						},
						span: { "object.kind": kind, "object.id": objectId.value },
					} satisfies SocketTarget as SocketTarget
				})

			/**
			 * The upgrade, forwarded to the target's object with its principal headers. The span is
			 * the object's parent, so its time before `SyncDO.connect` starts is the object's wake.
			 */
			const forward = (target: Extract<SocketTarget, { readonly _tag: "Target" }>, upgrade: Request) =>
				Effect.flatMap(traceHeaders, (trace) => {
					const headers = new Headers(upgrade.headers)
					for (const [name, value] of Object.entries({ ...trace, ...target.headers })) {
						headers.set(name, value)
					}
					return Effect.tryPromise({
						try: () => target.object.fetch(new Request(upgrade, { headers })),
						catch: (cause) =>
							new SyncForwardError({ objectId: target.headers[OBJECT_ID_HEADER], cause }),
					})
				}).pipe(Effect.withSpan("SyncRoute.forward", { kind: "client", attributes: target.span }))

			/** One stream of a `/sync/mux` socket: its source object's socket, accepted here for the relay. */
			const openMuxStream =
				(userId: UserId, verify: (token: string) => Effect.Effect<SocketTokenCheck>) =>
				(stream: typeof SyncMuxOpen.Type) =>
					Effect.gen(function* () {
						const { kind, sourceId: id, token } = stream
						const target = yield* socketTarget(kind, id, token, verify)
						if (target._tag === "Refused") return refuseMuxStream(target.code, target.reason)
						// One socket is one user's: a source cannot be opened with someone else's token.
						if (target.userId !== userId)
							return refuseMuxStream(SyncCloseCode.Forbidden, "wrong_user")
						const response = yield* forward(
							target,
							new Request(`https://object/sync/${kind}/${encodeURIComponent(id)}`, {
								headers: { upgrade: "websocket", "sec-websocket-protocol": SYNC_SUBPROTOCOL },
							}),
						)
						const socket = (
							response as Response & {
								webSocket?: (WorkerdSocket & Socket.WebSocketLike) | null
							}
						).webSocket
						if (socket === undefined || socket === null) {
							yield* Effect.logError("Sync object answered without a socket", {
								source: `${kind}:${id}`,
								status: response.status,
							})
							return refuseMuxStream(UNAVAILABLE, "unavailable")
						}
						socket.accept()
						return { _tag: "Opened", socket } satisfies MuxOpenResult as MuxOpenResult
					}).pipe(
						Effect.catchTag("SyncForwardError", (error) =>
							Effect.logError("Sync upgrade could not reach the object", {
								objectId: error.objectId,
								cause: String(error.cause),
							}).pipe(Effect.as(refuseMuxStream(UNAVAILABLE, "unavailable"))),
						),
						Effect.withSpan("SyncMux.open", {
							attributes: { "sync.source": `${stream.kind}:${stream.sourceId}` },
						}),
					)

			yield* router.add(
				"GET",
				"/sync/mux",
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					if (request.headers.upgrade?.toLowerCase() !== "websocket") {
						return HttpServerResponse.text("Expected a WebSocket upgrade", { status: 426 })
					}
					const token = tokenFromProtocols(
						request.headers["sec-websocket-protocol"],
						SYNC_MUX_SUBPROTOCOL,
					)
					if (token === undefined) {
						return acceptAndClose(SyncCloseCode.Reauth, "missing_token", SYNC_MUX_SUBPROTOCOL)
					}
					// The socket's token only says whose it is; each source is opened with its own,
					// most often this same one, which is then not checked again.
					const verify = makeSocketTokens(session)
					const verified = yield* verify(token)
					if (verified._tag === "Unavailable") {
						return acceptAndClose(UNAVAILABLE, "unavailable", SYNC_MUX_SUBPROTOCOL)
					}
					if (Option.isNone(verified.user)) {
						return acceptAndClose(SyncCloseCode.Reauth, "invalid_token", SYNC_MUX_SUBPROTOCOL)
					}
					const pair = makePair()
					const server = pair[1] as WorkerdSocket & Socket.WebSocketLike
					server.accept()
					yield* startMuxSession(server, openMuxStream(verified.user.value.user.id, verify))
					return toHttpServerResponse(
						new Response(null, {
							status: 101,
							webSocket: pair[0],
							headers: { "Sec-WebSocket-Protocol": SYNC_MUX_SUBPROTOCOL },
						} as unknown as ResponseInit),
					)
				}).pipe(Effect.withSpan("SyncRoute.muxUpgrade")),
			)

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

					const target = yield* socketTarget(kind, id, token, (value) =>
						verifySocketToken(session, value),
					)
					if (target._tag === "Refused") return acceptAndClose(target.code, target.reason)

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
					return yield* forward(target, web.value).pipe(
						Effect.map(toHttpServerResponse),
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
