/**
 * Client-side RPC auth middleware. Browsers authenticate RPC with the session cookie, which
 * the protocol sends through `RpcCredentialsLive`; the desktop app adds its session as a bearer.
 */
import { FetchHttpClient, Headers } from "effect/http"
import { RpcMiddleware } from "effect/rpc"
import { AuthMiddleware } from "@hazel/domain/rpc"
import { SessionLoadError } from "@hazel/domain/errors"
import { Effect, Layer } from "effect"
import { sessionAuthorizationEffect } from "./session-bearer"

export const AuthMiddlewareClientLive = RpcMiddleware.layerClient(AuthMiddleware, ({ request, next }) =>
	Effect.gen(function* () {
		const authorization = yield* sessionAuthorizationEffect.pipe(
			// An unreadable desktop session is the auth middleware's own "could not load the session".
			Effect.catchTag("SessionBearerError", () =>
				Effect.fail(
					new SessionLoadError({
						message: "Could not read the desktop session",
						detail: "The session store did not answer",
					}),
				),
			),
		)
		return yield* next(
			authorization === null
				? request
				: { ...request, headers: Headers.set(request.headers, "authorization", authorization) },
		)
	}),
)

/** Sends the API's session cookie with cross-origin RPC requests. */
export const RpcCredentialsLive = Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" })
