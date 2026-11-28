import { CurrentUser, InvalidBearerTokenError } from "@hazel/domain"
import { Effect, Layer, Option, Redacted } from "effect"
import { HttpServerRequest } from "effect/http"
import { HazelSession, looksLikeAccessToken } from "./hazel-session"

export const AuthorizationLive = Layer.effect(
	CurrentUser.Authorization,
	Effect.gen(function* () {
		yield* Effect.logDebug("Initializing Authorization middleware...")

		const hazelSession = yield* HazelSession

		return CurrentUser.Authorization.of({
			bearer: (httpEffect, { credential: bearerToken }) =>
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const token = Redacted.value(bearerToken)
					const isAccessToken = looksLikeAccessToken(token)

					// The API's access token (`POST /auth/token`), verified locally; as in the RPC
					// middleware. Invalid or expired: the cookie below, if any.
					if (isAccessToken) {
						const tokenUser = yield* hazelSession.verifyAccessToken(token)
						if (Option.isSome(tokenUser)) {
							return yield* Effect.provideService(
								httpEffect,
								CurrentUser.Context,
								tokenUser.value,
							)
						}
					}

					// Hazel session cookie (browser)
					const cookieUser = yield* hazelSession
						.fromCookie(request.headers, request.method)
						.pipe(
							Effect.catchTag("InvalidBearerTokenError", (error) =>
								token !== "" ? Effect.succeedNone : Effect.fail(error),
							),
						)
					if (Option.isSome(cookieUser)) {
						return yield* Effect.provideService(httpEffect, CurrentUser.Context, cookieUser.value)
					}

					// Hazel session credential (native clients)
					const sessionUser =
						token === "" || isAccessToken ? Option.none() : yield* hazelSession.verify(token)
					if (Option.isSome(sessionUser)) {
						return yield* Effect.provideService(
							httpEffect,
							CurrentUser.Context,
							sessionUser.value,
						)
					}

					return yield* new InvalidBearerTokenError({
						message: "Invalid session",
						detail: token === "" ? "No credential provided" : "Session expired or revoked",
					})
				}),
		})
	}),
)
