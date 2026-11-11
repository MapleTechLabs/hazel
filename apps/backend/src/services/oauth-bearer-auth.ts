import { createClerkClient } from "@clerk/backend"
import { UserRepo } from "@hazel/backend-core"
import { CurrentUser, SessionLoadError, UnauthorizedError } from "@hazel/domain"
import { ClerkUserId } from "@hazel/schema"
import { Cause, Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"

/**
 * Authenticates Bearer access tokens issued by Hazel's Clerk OAuth Applications.
 * Used by any external integration that has registered itself as an OAuth client
 * in Hazel's Clerk dashboard (Maple is the first consumer; others follow the same flow).
 *
 * Verifies the token via Clerk's IdP introspection endpoint, then resolves it
 * to a local Hazel user via `externalId` (Clerk user ID).
 *
 * NOTE: this is the last Clerk consumer in the backend. Sign-in itself runs on Hazel
 * auth; `CLERK_SECRET_KEY` is optional and only read here, so the public API v1 answers
 * 503 while it is unset. Drop this (and `@clerk/backend`) once Maple moves to Hazel-issued
 * OAuth tokens.
 */
export class OAuthBearerAuth extends Context.Service<OAuthBearerAuth>()("@hazel/backend/OAuthBearerAuth", {
	make: Effect.gen(function* () {
		const secretKey = yield* Config.option(Config.Redacted("CLERK_SECRET_KEY"))
		const clerk = Option.map(secretKey, (key) => createClerkClient({ secretKey: Redacted.value(key) }))
		const userRepo = yield* UserRepo

		const decodeClerkUserId = Schema.decodeUnknownEffect(ClerkUserId)

		const authenticate = (accessToken: string) =>
			Effect.gen(function* () {
				if (Option.isNone(clerk)) {
					return yield* Effect.fail(
						new SessionLoadError({
							message: "OAuth token verification is not configured",
							detail: "CLERK_SECRET_KEY is not set",
						}),
					)
				}
				const client = clerk.value

				const introspected = yield* Effect.tryPromise({
					try: () => client.idPOAuthAccessToken.verify(accessToken),
					catch: (error) => error,
				}).pipe(
					Effect.tapError((error) =>
						Effect.logWarning("OAuth access token verification failed", Cause.fail(error)),
					),
					Effect.mapError(
						() =>
							new UnauthorizedError({
								message: "Invalid OAuth access token",
								detail: "The token could not be verified",
							}),
					),
				)

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
					Effect.catchTag("DatabaseError", (error) =>
						Effect.logError("Failed to resolve OAuth user", Cause.fail(error)).pipe(
							Effect.andThen(
								Effect.fail(
									new SessionLoadError({
										message: "Failed to resolve OAuth user",
										detail: "The user store is unavailable",
									}),
								),
							),
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
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(UserRepo.layer))
}
