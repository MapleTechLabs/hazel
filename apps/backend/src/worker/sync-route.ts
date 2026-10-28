/**
 * `GET /sync/:kind/:id`: the sync WebSocket (`infra/durable-object-sync-plan.md` §3 Auth).
 *
 * The client offers `Sec-WebSocket-Protocol: hazel.v1, <session token>` (browsers cannot set an
 * Authorization header on a WebSocket). The token is verified the way the api verifies a bearer
 * session; the upgrade is then forwarded to the object with the principal and the object's id as
 * headers (objects are reachable only through bindings, so they trust them). The object
 * authorizes the principal against its own tables.
 *
 * A bad token is answered by accepting the socket and closing it with 4001 (`Reauth`): a browser
 * cannot read the HTTP status of a refused upgrade.
 */
import { SYNC_SUBPROTOCOL, SyncCloseCode } from "@hazel/domain/sync"
import { toHttpServerResponse } from "@hazel/sync-do"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HazelSession } from "../services/hazel-session"
import { isObjectKind, OBJECT_NAMESPACES } from "./objects/kinds"
import { encodeSyncPrincipal, OBJECT_ID_HEADER, PRINCIPAL_HEADER } from "./objects/principal"

interface WorkerdSocket {
	accept(): void
	close(code?: number, reason?: string): void
}

interface Namespace {
	getByName(name: string): { fetch(request: Request): Promise<Response> }
}

const SYNC_PATH = /^\/sync\/(org|channel|user)\/([^/?]+)/

/** `hazel.v1, <token>` → the token. */
export const tokenFromProtocols = (header: string | undefined): string | undefined => {
	const offered = (header ?? "").split(",").map((entry) => entry.trim())
	if (offered[0] !== SYNC_SUBPROTOCOL) return undefined
	const token = offered[1]
	return token === undefined || token.length === 0 ? undefined : token
}

/** A 101 whose socket is closed right away with `code`, so the browser sees the reason. */
const acceptAndClose = (code: number, reason: string) => {
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

const pathOf = (url: string) => {
	const path = url.startsWith("/") ? url : new URL(url).pathname
	const query = path.indexOf("?")
	return query === -1 ? path : path.slice(0, query)
}

export const makeSyncRoute = (env: Record<string, unknown>) =>
	HttpRouter.use((router) =>
		router.add(
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

				const session = yield* HazelSession
				const user = yield* session.verify(token).pipe(
					Effect.catchTags({
						InvalidBearerTokenError: () => Effect.succeedNone,
						SessionLoadError: (error) =>
							Effect.logWarning("Sync token verification failed", {
								detail: error.detail,
							}).pipe(Effect.as(Option.none())),
					}),
				)
				if (Option.isNone(user)) return acceptAndClose(SyncCloseCode.Reauth, "invalid_token")

				const namespace = env[OBJECT_NAMESPACES[kind]] as Namespace
				const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
				const headers = new Headers(web.headers)
				// TODO(do-sync): pass the session's expiry once HazelSession exposes it.
				headers.set(PRINCIPAL_HEADER, encodeSyncPrincipal({ userId: user.value.id, expiresAt: null }))
				headers.set(OBJECT_ID_HEADER, id)
				const response = yield* Effect.promise(() =>
					namespace.getByName(id).fetch(new Request(web, { headers })),
				)
				return toHttpServerResponse(response)
			}).pipe(Effect.withSpan("SyncRoute.upgrade")),
		),
	)
