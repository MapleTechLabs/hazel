import { CurrentUser } from "@hazel/domain"
import { Effect, Layer, Option, Redacted } from "effect"
import { HttpServerRequest } from "effect/http"
import { HazelSession } from "./hazel-session"
import { SessionManager } from "./session-manager"

/** Three base64url segments: a Clerk session JWT rather than a Hazel session credential. */
const isJwt = (token: string) => {
	const parts = token.split(".")
	return parts.length === 3 && parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))
}

export const AuthorizationLive = Layer.effect(
	CurrentUser.Authorization,
	Effect.gen(function* () {
		yield* Effect.logDebug("Initializing Authorization middleware...")

		const sessionManager = yield* SessionManager
		const hazelSession = yield* HazelSession

		return CurrentUser.Authorization.of({
			bearer: (httpEffect, { credential: bearerToken }) =>
				Effect.gen(function* () {
					// Hazel session cookie (browser)
					const request = yield* HttpServerRequest.HttpServerRequest
					const cookieUser = yield* hazelSession.fromCookie(request.headers, request.method)
					if (Option.isSome(cookieUser)) {
						return yield* Effect.provideService(httpEffect, CurrentUser.Context, cookieUser.value)
					}

					// Hazel session credential (native clients)
					const token = Redacted.value(bearerToken)
					if (hazelSession.enabled && token !== "" && !isJwt(token)) {
						const sessionUser = yield* hazelSession.verify(token)
						if (Option.isSome(sessionUser)) {
							return yield* Effect.provideService(
								httpEffect,
								CurrentUser.Context,
								sessionUser.value,
							)
						}
					}

					// Clerk session JWT
					const user = yield* sessionManager.authenticateWithBearer(token)
					return yield* Effect.provideService(httpEffect, CurrentUser.Context, user)
				}),
		})
	}),
)
