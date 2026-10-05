import { and, Database, eq, isNull, schema } from "@hazel/db"
import type { BotId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { AccessContextCacheService, type BotAccessContext } from "../cache"

// Re-export BotAccessContext from cache module
export type { BotAccessContext } from "../cache"

/**
 * Authenticated bot context
 */
export interface AuthenticatedBot {
	botId: BotId
	userId: UserId
	accessContext: BotAccessContext
}

/**
 * Bot authentication error
 */
export class BotAuthenticationError extends Schema.TaggedError<BotAuthenticationError>(
	"BotAuthenticationError",
)("BotAuthenticationError", {
	message: Schema.String,
	detail: Schema.optional(Schema.String),
}) {}

/**
 * Hash a token using SHA-256 (Web Crypto API - available in Bun)
 */
async function hashToken(token: string): Promise<string> {
	const encoder = new TextEncoder()
	const data = encoder.encode(token)
	const hashBuffer = await crypto.subtle.digest("SHA-256", data)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Validate a Bearer token for bot authentication.
 *
 * Flow:
 * 1. Extract Bearer token from Authorization header
 * 2. Hash token with SHA-256
 * 3. Query bots table by apiTokenHash
 * 4. Resolve bot access context from cache/database
 * 5. Return AuthenticatedBot with channel access context
 */
export const validateBotToken = Effect.fn("ElectricProxy.validateBotToken")(function* (request: Request) {
	// Extract Bearer token from Authorization header
	const authHeader = request.headers.get("Authorization")
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		yield* Effect.annotateCurrentSpan("auth.header.present", false)
		return yield* Effect.fail(
			new BotAuthenticationError({
				message: "Missing or invalid Authorization header",
				detail: "Expected 'Bearer <token>'",
			}),
		)
	}

	const token = authHeader.slice(7) // Remove "Bearer " prefix
	yield* Effect.annotateCurrentSpan("auth.header.present", true)
	yield* Effect.annotateCurrentSpan("auth.scheme", "bearer")

	// Hash the token
	const tokenHash = yield* Effect.promise(() => hashToken(token))

	// Query bot by token hash
	const db = yield* Database.Database
	const botResult = yield* db.execute((client) =>
		client
			.select({
				id: schema.botsTable.id,
				userId: schema.botsTable.userId,
			})
			.from(schema.botsTable)
			.where(and(eq(schema.botsTable.apiTokenHash, tokenHash), isNull(schema.botsTable.deletedAt)))
			.limit(1),
	)
	const botOption = Option.fromNullishOr(botResult[0])

	if (Option.isNone(botOption)) {
		yield* Effect.annotateCurrentSpan("auth.token.valid", false)
		return yield* Effect.fail(
			new BotAuthenticationError({
				message: "Invalid bot token",
				detail: "No bot found with this token",
			}),
		)
	}

	const bot = botOption.value
	yield* Effect.annotateCurrentSpan("auth.token.valid", true)

	// Get cached access context from Redis-backed cache
	const cache = yield* AccessContextCacheService
	const accessContext = yield* cache.getBotContext(bot.id, bot.userId)
	yield* Effect.annotateCurrentSpan("proxy.bot.channel_count", accessContext.channelIds.length)

	return {
		botId: bot.id,
		userId: bot.userId,
		accessContext,
	} satisfies AuthenticatedBot
})
