import { verifyToken } from "@clerk/backend"
import { Database, eq, schema } from "@hazel/db"
import { ClerkJwtClaims } from "@hazel/schema"
import { Context, Config, Effect, Layer, Option, Redacted, Schema } from "effect"
import { UserLookupCache } from "../cache/user-lookup-cache.ts"
import type { AuthenticatedUserContext } from "../types.ts"

export class ProxyAuthenticationError extends Schema.TaggedError<ProxyAuthenticationError>()(
	"ProxyAuthenticationError",
	{
		message: Schema.String,
		detail: Schema.optional(Schema.String),
	},
) {}

/**
 * Electric-proxy authentication service.
 *
 * Verifies a Clerk bearer JWT and resolves it to an internal Hazel user. Does
 * NOT upsert users — if the user isn't already in the DB (via Clerk webhook
 * sync), the request is rejected.
 */
export class ProxyAuth extends Context.Service<ProxyAuth>()("@hazel/auth/ProxyAuth", {
	make: Effect.gen(function* () {
		const userLookupCache = yield* UserLookupCache
		const db = yield* Database.Database
		const decodeClerkClaims = Schema.decodeUnknownEffect(ClerkJwtClaims)
		const clerkSecretKey = yield* Config.Redacted("CLERK_SECRET_KEY")

		const lookupUser = Effect.fn("ProxyAuth.lookupUser")(function* (externalId: string) {
			const cached = yield* userLookupCache
				.get(externalId)
				.pipe(
					Effect.catch((error) =>
						Effect.logWarning("User lookup cache error", error).pipe(
							Effect.map(() =>
								Option.none<{
									internalUserId: (typeof schema.usersTable.$inferSelect)["id"]
								}>(),
							),
						),
					),
				)

			if (Option.isSome(cached)) {
				yield* Effect.annotateCurrentSpan("cache.result", "hit")
				return Option.some(cached.value.internalUserId)
			}

			const userResult = yield* db
				.execute((client) =>
					client
						.select({ id: schema.usersTable.id })
						.from(schema.usersTable)
						.where(eq(schema.usersTable.externalId, externalId))
						.limit(1),
				)
				.pipe(
					Effect.catchTag("DatabaseError", (error) =>
						Effect.fail(
							new ProxyAuthenticationError({
								message: "Failed to lookup user in database",
								detail: error.message,
							}),
						),
					),
				)
			const userOption = Option.fromNullishOr(userResult[0])

			if (Option.isSome(userOption)) {
				yield* userLookupCache
					.set(externalId, userOption.value.id)
					.pipe(Effect.catch((error) => Effect.logWarning("Failed to cache user lookup", error)))
			}

			return Option.map(userOption, (user) => user.id)
		})

		const validateBearerToken = Effect.fn("ProxyAuth.validateBearerToken")(function* (
			bearerToken: string,
		) {
			const payload = yield* Effect.tryPromise({
				try: () => verifyToken(bearerToken, { secretKey: Redacted.value(clerkSecretKey) }),
				catch: (error) =>
					new ProxyAuthenticationError({
						message: "Clerk JWT verification failed",
						detail: String(error),
					}),
			})

			const claims = yield* decodeClerkClaims(payload).pipe(
				Effect.mapError(
					(error) =>
						new ProxyAuthenticationError({
							message: "Invalid Clerk JWT claims",
							detail: String(error),
						}),
				),
			)

			const userIdOption = yield* lookupUser(claims.sub).pipe(
				Effect.withSpan("ProxyAuth.lookupUser", {
					attributes: { "clerk.user_id": claims.sub },
				}),
			)

			if (Option.isNone(userIdOption)) {
				yield* Effect.annotateCurrentSpan("user.found", false)
				return yield* new ProxyAuthenticationError({
					message: "User not found in database",
					detail: `User must be created via Clerk webhook first. Clerk ID: ${claims.sub}`,
				})
			}

			yield* Effect.annotateCurrentSpan("user.found", true)
			yield* Effect.annotateCurrentSpan("user.id", userIdOption.value)

			return {
				externalId: claims.sub,
				internalUserId: userIdOption.value,
				email: claims.email ?? "",
				organizationId: undefined,
				role: claims.org_role === "org:admin" ? "admin" : "member",
			} satisfies AuthenticatedUserContext
		})

		return {
			validateBearerToken,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(UserLookupCache.layer))
}

export const ProxyAuthLive = ProxyAuth.layer
