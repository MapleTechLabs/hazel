/**
 * Bot token authentication for the gateway Worker: a lookup of the token's SHA-256 hash in the
 * directory D1 database (where `bots` lives).
 */
import type { D1Database } from "@cloudflare/workers-types"
import { BotRepo } from "@hazel/backend-core/repositories"
import { Database } from "@hazel/db"
import { Effect, Layer, Option } from "effect"
import type { AuthResult } from "./relay.ts"

export const hashBotToken = async (token: string): Promise<string> => {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Look a bot up by token in the directory database. */
export const authenticateBotToken = (token: string, directory: D1Database): Effect.Effect<AuthResult> =>
	Effect.gen(function* () {
		const tokenHash = yield* Effect.promise(() => hashBotToken(token))
		const repo = yield* BotRepo
		const bot = yield* repo.findByTokenHash(tokenHash)
		return Option.match(bot, {
			onNone: (): AuthResult => ({ _tag: "Rejected", reason: "Invalid bot token" }),
			onSome: (found): AuthResult => ({ _tag: "Authenticated", botId: found.id, botName: found.name }),
		})
	}).pipe(
		Effect.catchTag("DatabaseError", (error) =>
			Effect.succeed<AuthResult>({ _tag: "Unavailable", reason: `bot lookup failed: ${error.type}` }),
		),
		Effect.provide(BotRepo.layer.pipe(Layer.provide(Database.layerD1(directory)))),
		Effect.withSpan("BotGateway.authenticate"),
	)
