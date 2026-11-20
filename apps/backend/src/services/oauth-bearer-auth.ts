import type { ClerkClient } from "@clerk/backend"
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
/** The one part of Clerk's client this service calls. */
interface ClerkVerifier {
	readonly idPOAuthAccessToken: Pick<ClerkClient["idPOAuthAccessToken"], "verify">
}

/** Loads Clerk's SDK: `import("@clerk/backend")`, or a test's stand-in. */
export type LoadClerk = () => Promise<{
	readonly createClerkClient: (options: { readonly secretKey: string }) => ClerkVerifier
}>

/** The service, with Clerk's SDK loaded by `loadClerk` on the first token. */
export const makeOAuthBearerAuth = (loadClerk: LoadClerk) =>
	Effect.gen(function* () {
		const secretKey = yield* Config.option(Config.Redacted("CLERK_SECRET_KEY"))
		// The SDK loads on the first token, not with the layer: the objects build this layer too,
		// and a cold isolate would otherwise evaluate it at start.
		const clerk = Option.map(secretKey, (key) => {
			let client: ClerkVerifier | undefined
			return async () =>
				(client ??= (await loadClerk()).createClerkClient({
					secretKey: Redacted.value(key),
				}))
		})
		const userRepo = yield* UserRepo

		const decodeClerkUserId = Schema.decodeUnknownEffect(ClerkUserId)

		const authenticate = Effect.fn("OAuthBearerAuth.authenticate")(function* (accessToken: string) {
			if (Option.isNone(clerk)) {
				return yield* new SessionLoadError({
					message: "OAuth token verification is not configured",
					detail: "CLERK_SECRET_KEY is not set",
				})
			}
			// The SDK failing to load is ours, not the token's: a 500, never "invalid token".
			const client = yield* Effect.tryPromise(clerk.value).pipe(
				Effect.tapError((error) => Effect.logError("Clerk SDK failed to load", Cause.fail(error))),
				Effect.mapError(
					() =>
						new SessionLoadError({
							message: "OAuth token verification is unavailable",
							detail: "The Clerk SDK failed to load",
						}),
				),
			)

			const introspected = yield* Effect.tryPromise(() =>
				client.idPOAuthAccessToken.verify(accessToken),
			).pipe(
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
				return yield* new UnauthorizedError({
					message: "OAuth access token has been revoked",
					detail: introspected.revocationReason ?? "revoked",
				})
			}

			if (introspected.expired) {
				return yield* new UnauthorizedError({
					message: "OAuth access token has expired",
					detail: "expired",
				})
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

			const user = yield* Effect.fromOption(
				userOption,
				() =>
					new UnauthorizedError({
						message:
							"OAuth user has no Hazel account. Sign in to Hazel at least once to provision an account, then retry.",
						detail: clerkUserId,
					}),
			)

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
		})

		return {
			authenticate,
		} as const
	})

export class OAuthBearerAuth extends Context.Service<OAuthBearerAuth>()("@hazel/backend/OAuthBearerAuth", {
	make: makeOAuthBearerAuth(() => import("@clerk/backend")),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(UserRepo.layer))
}
