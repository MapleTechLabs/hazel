/**
 * The public bot API's authentication: `Authorization: Bearer hzl_bot_…`, matched by its SHA-256
 * against the directory's `bots`. A bot acts as its machine user.
 */
import { HttpServerRequest } from "effect/http"
import { BotRepo } from "@hazel/backend-core"
import { CurrentUser, UnauthorizedError } from "@hazel/domain"
import { ApiScope } from "@hazel/domain/scopes"
import type { UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"

/** Hash a token using SHA-256 (Web Crypto API). */
export async function hashToken(token: string): Promise<string> {
	const data = new TextEncoder().encode(token)
	const hashBuffer = await crypto.subtle.digest("SHA-256", data)
	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
}

/** Authenticate the bot from its Bearer token. */
export const authenticateBotFromToken = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	const authHeader = request.headers.authorization
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return yield* new UnauthorizedError({
			message: "Missing or invalid API token",
			detail: "Authorization header must be 'Bearer <token>'",
		})
	}
	const tokenHash = yield* Effect.promise(() => hashToken(authHeader.slice(7)))
	const bot = yield* (yield* BotRepo).findByTokenHash(tokenHash)
	if (Option.isNone(bot)) {
		return yield* new UnauthorizedError({
			message: "Invalid API token",
			detail: "No bot found with this token",
		})
	}
	return bot.value
})

const isApiScope = Schema.is(ApiScope)

/**
 * Bots act as their user, held to the scopes they declared — as on the RPC path
 * (`rpc/middleware/auth.ts`), so a bot can do the same things over either. A bot row with no
 * scopes recorded keeps a member's, as this API always gave it.
 */
export const botPrincipal = (bot: {
	readonly userId: UserId
	readonly name: string
	readonly scopes: ReadonlyArray<string> | null
}) => ({
	user: new CurrentUser.Schema({
		id: bot.userId,
		role: "member",
		email: `bot-${bot.name}@hazel.bot`,
		isOnboarded: true,
		timezone: null,
		settings: null,
	}),
	botScopes: bot.scopes === null ? null : bot.scopes.filter(isApiScope),
})
