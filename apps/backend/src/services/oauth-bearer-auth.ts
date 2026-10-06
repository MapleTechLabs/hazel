import { ClerkClient } from "@hazel/auth"
import { UserRepo } from "@hazel/backend-core"
import { CurrentUser, UnauthorizedError } from "@hazel/domain"
import { ClerkUserId } from "@hazel/schema"
import { Context, Effect, Layer, Option, Schema } from "effect"

/**
 * Authenticates Bearer access tokens issued by Hazel's Clerk OAuth Applications.
 * Used by any external integration that has registered itself as an OAuth client
 * in Hazel's Clerk dashboard (Maple is the first consumer; others follow the same flow).
 *
 * Verifies the token via Clerk's IdP introspection endpoint, then resolves it
 * to a local Hazel user via `externalId` (Clerk user ID).
 *
 * This is distinct from `BackendAuth.authenticate`, which verifies *session*
 * JWTs minted by Clerk for browser-authenticated users. OAuth Application
 * access tokens are a different token class (issued via /oauth/token) and need
 * the IdP introspection path.
 */
export class OAuthBearerAuth extends Context.Service<OAuthBearerAuth>()("@hazel/backend/OAuthBearerAuth", {
	make: Effect.gen(function* () {
		const clerk = yield* ClerkClient
		const userRepo = yield* UserRepo

		const decodeClerkUserId = Schema.decodeUnknownEffect(ClerkUserId)

		const authenticate = (accessToken: string) =>
			Effect.gen(function* () {
				const introspected = yield* Effect.tryPromise({
					try: () => clerk.raw.idPOAuthAccessToken.verify(accessToken),
					catch: (error) =>
						new UnauthorizedError({
							message: "Invalid OAuth access token",
							detail: String(error),
						}),
				})

				if (introspected.revoked) {
					return yield* Effect.fail(
						new UnauthorizedError({
							message: "OAuth access token has been revoked",
							detail: introspected.revocationReason ?? "revoked",
						}),
					)
				}

				if (introspected.expired) {
					return yield* Effect.fail(
						new UnauthorizedError({
							message: "OAuth access token has expired",
							detail: "expired",
						}),
					)
				}

				const clerkUserId = yield* decodeClerkUserId(introspected.subject).pipe(
					Effect.mapError(
						() =>
							new UnauthorizedError({
								message: "OAuth access token has an invalid subject",
								detail: introspected.subject,
							}),
					),
				)

				const userOption = yield* userRepo.findByExternalId(clerkUserId).pipe(
					Effect.catchTag("DatabaseError", (err) =>
						Effect.fail(
							new UnauthorizedError({
								message: "Failed to resolve OAuth user",
								detail: String(err),
							}),
						),
					),
				)

				const user = yield* Option.match(userOption, {
					onSome: (u) => Effect.succeed(u),
					onNone: () =>
						Effect.fail(
							new UnauthorizedError({
								message:
									"OAuth user has no Hazel account. Sign in to Hazel at least once to provision an account, then retry.",
								detail: clerkUserId,
							}),
						),
				})

				return {
					currentUser: new CurrentUser.Schema({
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
					scopes: introspected.scopes,
					clientId: introspected.clientId,
				}
			}).pipe(Effect.withSpan("OAuthBearerAuth.authenticate"))

		return {
			authenticate,
		} as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(ClerkClient.layer),
		Layer.provide(UserRepo.layer),
	)
}
