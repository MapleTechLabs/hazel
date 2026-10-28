import { Database, SQLite, schema } from "@hazel/db"
import { Cluster, Integrations } from "@hazel/domain"
import type { UserId } from "@hazel/schema"
import { Context, Array, Effect, Layer, Option } from "effect"

/**
 * Service for cached bot user lookups.
 *
 * Bot users are created once during integration setup and rarely change.
 * This service caches the bot user ID at initialization to avoid
 * repeated database queries on every webhook.
 */
export class BotUserService extends Context.Service<BotUserService>()("BotUserService", {
	make: Effect.gen(function* () {
		const db = yield* Database.Database

		// Cache for bot user IDs by external ID
		const cache = new Map<string, UserId>()

		/**
		 * Get the bot user ID for a provider, with caching.
		 * Falls back to database lookup if not cached.
		 */
		const getBotUserId = (provider: "github" | "linear" | "figma" | "notion" | "rss") =>
			Effect.gen(function* () {
				const externalId = Integrations.makeIntegrationBotExternalId(provider)

				yield* Effect.annotateCurrentSpan("cache.system", "memory")
				yield* Effect.annotateCurrentSpan("cache.name", "bot-user")
				yield* Effect.annotateCurrentSpan("cache.operation", "get")

				// Check cache first
				const cached = cache.get(externalId)
				if (cached) {
					yield* Effect.annotateCurrentSpan("cache.result", "hit")
					return Option.some(cached)
				}

				yield* Effect.annotateCurrentSpan("cache.result", "miss")

				// Query database
				const results = yield* db
					.run(
						SQLite.from(schema.usersTable)
							.select("id")
							.where(($) => [$.externalId.eq(externalId)])
							.limit(1),
					)
					.pipe(
						Effect.catchTags({
							DatabaseError: (err) =>
								Effect.fail(
									new Cluster.BotUserQueryError({
										provider,
										message: `Failed to query bot user for ${provider}`,
										cause: err,
									}),
								),
						}),
					)

				const headOption = Array.head(results)
				if (Option.isNone(headOption)) {
					yield* Effect.logWarning(`Bot user not found for provider: ${provider}`, {
						externalId,
					})
					return Option.none<UserId>()
				}

				const userId = headOption.value.id

				// Cache the result
				cache.set(externalId, userId)

				yield* Effect.logDebug(`Cached bot user ID for ${provider}`, {
					externalId,
					userId,
				})

				return Option.some(userId)
			}).pipe(
				Effect.withSpan("BotUserService.getBotUserId", {
					attributes: { "bot.provider": provider },
				}),
			)

		/**
		 * Get GitHub bot user ID.
		 * Returns None if the bot user has not been created.
		 */
		const getGitHubBotUserId = () => getBotUserId("github")

		/**
		 * Get RSS bot user ID.
		 * Returns None if the bot user has not been created.
		 */
		const getRssBotUserId = () => getBotUserId("rss")

		/**
		 * Pre-warm the cache by loading common bot user IDs.
		 * Call this at service initialization if needed.
		 */
		const warmCache = Effect.gen(function* () {
			yield* Effect.logDebug("Warming bot user cache...")
			const providers = ["github", "linear", "figma", "notion", "rss"] as const
			yield* Effect.forEach(providers, (p) => getBotUserId(p), { concurrency: "unbounded" })
			yield* Effect.annotateCurrentSpan("cache.warmed_count", cache.size)
			yield* Effect.logDebug(`Bot user cache warmed with ${cache.size} entries`)
		}).pipe(Effect.withSpan("BotUserService.warmCache"))

		return {
			getBotUserId,
			getGitHubBotUserId,
			getRssBotUserId,
			warmCache,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}

/**
 * Layer that provides BotUserService with Database dependency.
 */
export const BotUserServiceLive = BotUserService.layer
