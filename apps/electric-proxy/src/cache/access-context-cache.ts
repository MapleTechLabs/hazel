import type { ChannelId } from "@hazel/schema"
import { Duration, Schema } from "effect"
import { Persistable } from "effect/persistence"

/**
 * Cache configuration constants
 */
export const CACHE_STORE_ID = "electric-proxy:access-context"
export const CACHE_TTL = Duration.seconds(60)
export const IN_MEMORY_CAPACITY = 1000
export const IN_MEMORY_TTL = Duration.seconds(10)

/**
 * Schema for BotAccessContext - the cached value for bot requests
 */
export const BotAccessContextSchema = Schema.Struct({
	channelIds: Schema.Array(Schema.String),
})

export type BotAccessContext = {
	channelIds: readonly ChannelId[]
}

/**
 * Cache lookup error - when we fail to fetch from database
 */
export class AccessContextLookupError extends Schema.TaggedError<AccessContextLookupError>()(
	"AccessContextLookupError",
	{
		message: Schema.String,
		detail: Schema.optional(Schema.String),
		entityId: Schema.String,
		entityType: Schema.Literals(["user", "bot"]),
	},
) {}

/**
 * Cache request for bot access context.
 * Implements Persistable.Class (provides persistence key and schemas) and PrimaryKey.
 */
export class BotAccessContextRequest extends Persistable.Class<{
	payload: {
		botId: string
		userId: string
	}
}>()("BotAccessContextRequest", {
	primaryKey: (payload) => `bot:${payload.botId}`,
	success: BotAccessContextSchema,
	error: AccessContextLookupError,
}) {}
