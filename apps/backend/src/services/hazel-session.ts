import { HazelAuth } from "@hazel/auth/server"
import { UserRepo } from "@hazel/backend-core"
import { CurrentUser, InvalidBearerTokenError, SessionLoadError } from "@hazel/domain"
import type { UserId } from "@hazel/schema"
import { Context, Effect, Layer, Option, Redacted } from "effect"
import { Cookies, Headers } from "effect/http"
import { HazelAuthInstance } from "./hazel-auth"

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
			userRepo.findById(subjectId as UserId).pipe(
				Effect.catchTags({
					DatabaseError: (error) =>
						Effect.fail(
							new SessionLoadError({ message: "Failed to load user", detail: String(error) }),
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
											organizationId: undefined,
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

		/** Verifies a session credential; `None` when it is not a valid Hazel session. */
		const verify = (
			credential: string,
		): Effect.Effect<Option.Option<CurrentUser.Schema>, InvalidBearerTokenError | SessionLoadError> =>
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
				return Option.some(yield* loadUser(session.value.subjectId))
			})

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

		return { enabled, verify, fromCookie } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(UserRepo.layer))
}
