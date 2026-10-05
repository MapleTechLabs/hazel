import { PersistedCache, Persistence } from "effect/persistence"
import { and, Database, eq, isNull, schema } from "@hazel/db"
import type { BotId, ChannelId, UserId } from "@hazel/schema"
import { Context, Effect, Layer, Schema } from "effect"
import {
	AccessContextLookupError,
	type BotAccessContext,
	BotAccessContextRequest,
	CACHE_STORE_ID,
	CACHE_TTL,
	IN_MEMORY_CAPACITY,
	IN_MEMORY_TTL,
} from "./access-context-cache"

/**
 * Service interface for access context caching.
 * Provides get/invalidate methods for bot contexts.
 */
export interface AccessContextCache {
	readonly getBotContext: (
		botId: BotId,
		userId: UserId,
	) => Effect.Effect<
		BotAccessContext,
		AccessContextLookupError | Persistence.PersistenceError | Schema.SchemaError
	>

	readonly invalidateBot: (botId: BotId) => Effect.Effect<void, Persistence.PersistenceError>
}

/**
 * Access context caching service.
 * Uses PersistedCache to cache bot access contexts with Redis persistence.
 *
 * Note: Database.Database is intentionally NOT included in dependencies
 * as it's a global infrastructure layer provided at the application root.
 */
export class AccessContextCacheService extends Context.Service<AccessContextCacheService>()(
	"AccessContextCacheService",
	{
		make: Effect.gen(function* () {
			const db = yield* Database.Database

			// Create bot access context cache
			const botCache = yield* PersistedCache.make(
				(request: BotAccessContextRequest) =>
					Effect.gen(function* () {
						yield* Effect.annotateCurrentSpan("cache.lookup_performed", true)
						yield* Effect.annotateCurrentSpan("cache.result", "miss")
						const botId = request.botId as BotId

						// Query channels in all orgs where the bot is installed.
						// Bots are org-level (not channel members), so we join
						// bot_installations → channels by organizationId.
						const channels = yield* db
							.execute((client) =>
								client
									.selectDistinct({ channelId: schema.channelsTable.id })
									.from(schema.botInstallationsTable)
									.innerJoin(
										schema.channelsTable,
										and(
											eq(
												schema.channelsTable.organizationId,
												schema.botInstallationsTable.organizationId,
											),
											isNull(schema.channelsTable.deletedAt),
										),
									)
									.where(eq(schema.botInstallationsTable.botId, botId)),
							)
							.pipe(
								Effect.catchTag("DatabaseError", (error) =>
									Effect.fail(
										new AccessContextLookupError({
											message: "Failed to query bot's channels",
											detail: error.message,
											entityId: request.botId,
											entityType: "bot",
										}),
									),
								),
							)

						const channelIds = channels.map((c: { channelId: ChannelId }) => c.channelId)
						yield* Effect.annotateCurrentSpan("cache.result_size", channelIds.length)

						return { channelIds }
					}),
				{
					storeId: `${CACHE_STORE_ID}:bot`,
					timeToLive: (_exit, _request) => CACHE_TTL,
					inMemoryCapacity: IN_MEMORY_CAPACITY,
					inMemoryTTL: (_exit, _request) => IN_MEMORY_TTL,
				},
			)

			return {
				getBotContext: Effect.fn("AccessContextCache.getBotContext")(function* (
					botId: BotId,
					userId: UserId,
				) {
					yield* Effect.annotateCurrentSpan("cache.system", "redis")
					yield* Effect.annotateCurrentSpan("cache.name", "electric-proxy:access-context:bot")
					yield* Effect.annotateCurrentSpan("cache.operation", "get")
					yield* Effect.annotateCurrentSpan("cache.lookup_performed", false)
					yield* Effect.annotateCurrentSpan("cache.result", "hit")
					const result = yield* botCache.get(new BotAccessContextRequest({ botId, userId }))
					return { channelIds: result.channelIds as readonly ChannelId[] }
				}),

				invalidateBot: Effect.fn("AccessContextCache.invalidateBot")(function* (botId: BotId) {
					yield* Effect.annotateCurrentSpan("cache.system", "redis")
					yield* Effect.annotateCurrentSpan("cache.name", "electric-proxy:access-context:bot")
					yield* Effect.annotateCurrentSpan("cache.operation", "invalidate")
					// Note: We don't have userId here, but invalidation only uses the primary key (botId)
					yield* botCache.invalidate(new BotAccessContextRequest({ botId, userId: "" as UserId }))
				}),
			} satisfies AccessContextCache
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
