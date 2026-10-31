import { AccessToken, HazelAuth } from "@hazel/auth/server"
import { UserRepo } from "@hazel/backend-core"
import { CurrentUser, InvalidBearerTokenError, SessionLoadError } from "@hazel/domain"
import { UserId } from "@hazel/schema"
import { Cause, Context, DateTime, Effect, Layer, Option, Redacted } from "effect"
import { Cookies, Headers } from "effect/http"
import { HazelAuthInstance } from "./hazel-auth"

/** A verified credential's user and when the credential stops being valid (epoch ms). */
export interface VerifiedUser {
	readonly user: CurrentUser.Schema
	readonly expiresAt: number
}

/**
 * Resolves Hazel sessions (`@hazel/auth/server`) to the current user for the RPC and
 * HttpApi auth middleware. Browsers send the session as an HttpOnly cookie on the API
 * host; native clients send the credential as a bearer token.
 */
export class HazelSession extends Context.Service<HazelSession>()("@hazel/backend/HazelSession", {
	make: Effect.gen(function* () {
		const instance = yield* HazelAuthInstance
		const auth = yield* Effect.serviceOption(HazelAuth)
		const userRepo = yield* UserRepo

		const enabled = Option.isSome(instance) && Option.isSome(auth)
		const cookieName = Option.isSome(instance) ? instance.value.sessionCookieName : undefined
		const allowedOrigins = new Set(
			Option.isSome(instance)
				? [instance.value.config.origin, ...(instance.value.config.trustedOrigins ?? [])]
				: [],
		)

		const invalid = (detail: string) =>
			new InvalidBearerTokenError({ message: "Invalid session", detail })

		const loadUser = (subjectId: string) =>
			userRepo.findById(UserId.make(subjectId)).pipe(
				Effect.catchTags({
					DatabaseError: (error) =>
						Effect.logError("Failed to load the session user", Cause.fail(error)).pipe(
							Effect.andThen(
								Effect.fail(
									new SessionLoadError({
										message: "Failed to load user",
										detail: "The session store is unavailable",
									}),
								),
							),
						),
				}),
				Effect.flatMap(
					Option.match({
						onNone: () => Effect.fail(invalid("User not found")),
						onSome: (user) =>
							user.deletedAt !== null
								? Effect.fail(invalid("User is deleted"))
								: Effect.succeed(
										new CurrentUser.Schema({
											id: user.id,
											role: "member",
											avatarUrl: user.avatarUrl ?? undefined,
											firstName: user.firstName,
											lastName: user.lastName,
											email: user.email,
											isOnboarded: user.isOnboarded,
											timezone: user.timezone,
											settings: user.settings,
										}),
									),
					}),
				),
			)

		/** A session credential with its expiry (epoch ms); `None` when it is not a valid one. */
		const verifyWithExpiry = (
			credential: string,
		): Effect.Effect<Option.Option<VerifiedUser>, InvalidBearerTokenError | SessionLoadError> =>
			Effect.gen(function* () {
				if (Option.isNone(auth)) return Option.none()
				const session = yield* auth.value.verifySession(Redacted.make(credential)).pipe(
					Effect.map(Option.some),
					Effect.catchTag("SessionInvalid", () => Effect.succeedNone),
					// Every other outcome is the session store failing, not a bad credential.
					Effect.mapError(
						(error) =>
							new SessionLoadError({
								message: "Session verification failed",
								detail: error._tag,
							}),
					),
				)
				if (Option.isNone(session)) return Option.none()
				return Option.some({
					user: yield* loadUser(session.value.subjectId),
					expiresAt: DateTime.toEpochMillis(session.value.expiresAt),
				})
			})

		/** Verifies a session credential; `None` when it is not a valid Hazel session. */
		const verify = (credential: string) =>
			verifyWithExpiry(credential).pipe(Effect.map(Option.map((verified) => verified.user)))

		// The API's own access tokens (`POST /auth/token`), for the sync route; none without a key.
		const accessVerifier =
			Option.isSome(instance) && Option.isSome(instance.value.accessTokens)
				? Option.some(
						yield* AccessToken.makeLocalVerifier(
							instance.value.config.origin,
							instance.value.accessTokens.value,
						),
					)
				: Option.none()

		/**
		 * An access token with its `exp` (epoch ms); `None` when it is not a valid one (expired,
		 * foreign, malformed). Tokens live minutes, far less than their session.
		 */
		const verifyAccessTokenWithExpiry = (
			token: string,
		): Effect.Effect<Option.Option<VerifiedUser>, InvalidBearerTokenError | SessionLoadError> =>
			Effect.gen(function* () {
				if (Option.isNone(accessVerifier)) return Option.none()
				const access = yield* accessVerifier.value.verify(token).pipe(
					Effect.map(Option.some),
					Effect.catchTags({
						AccessTokenInvalid: () => Effect.succeedNone,
						AccessTokenUnavailable: (error) =>
							Effect.fail(
								new SessionLoadError({
									message: "Access token keys are unavailable",
									detail: error.reason,
								}),
							),
					}),
				)
				if (Option.isNone(access)) return Option.none()
				return Option.some({
					user: yield* loadUser(access.value.userId),
					expiresAt: access.value.expiresAt,
				})
			})

		/** Verifies an access token; `None` when it is not a valid one (expired, foreign, malformed). */
		const verifyAccessToken = (token: string) =>
			verifyAccessTokenWithExpiry(token).pipe(Effect.map(Option.map((verified) => verified.user)))

		/**
		 * The session cookie, if the request carries one. Cookie-authenticated requests must
		 * come from a trusted origin: mutations are POSTs, which browsers always send with an
		 * Origin, so a missing or foreign Origin means a cross-site request.
		 */
		const fromCookie = (
			headers: Headers.Headers,
			method: string,
		): Effect.Effect<Option.Option<CurrentUser.Schema>, InvalidBearerTokenError | SessionLoadError> =>
			Effect.gen(function* () {
				if (!enabled || cookieName === undefined) return Option.none<CurrentUser.Schema>()
				const cookie = Option.flatMap(Headers.get(headers, "cookie"), (header) =>
					Option.fromNullishOr(Cookies.parseHeader(header)[cookieName]),
				)
				if (Option.isNone(cookie)) return Option.none<CurrentUser.Schema>()

				const origin = Headers.get(headers, "origin")
				const safe = method === "GET" || method === "HEAD"
				if (!safe && (Option.isNone(origin) || !allowedOrigins.has(origin.value))) {
					return yield* Effect.fail(invalid("Untrusted origin for a cookie session"))
				}

				const user = yield* verify(cookie.value)
				if (Option.isNone(user)) return yield* Effect.fail(invalid("Session expired or revoked"))
				return user
			})

		return {
			enabled,
			verify,
			verifyWithExpiry,
			verifyAccessToken,
			verifyAccessTokenWithExpiry,
			fromCookie,
		} as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(UserRepo.layer))
}
