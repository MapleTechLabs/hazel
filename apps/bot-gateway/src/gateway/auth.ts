/**
 * Bot token authentication for the gateway Worker: the same SHA-256 token-hash lookup the Bun
 * gateway did, through Hyperdrive with a connection opened for this one lookup (a Worker's TCP
 * socket belongs to the invocation that opened it).
 */
import { BotRepo } from "@hazel/backend-core/repositories"
import { Database } from "@hazel/db"
import { Effect, Layer, Option } from "effect"
import type { AuthResult } from "./relay.ts"

export const hashBotToken = async (token: string): Promise<string> => {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Look a bot up by token; `connectionString` is the Hyperdrive binding's. */
export const authenticateBotToken = (token: string, connectionString: string): Effect.Effect<AuthResult> =>
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
		Effect.provide(BotRepo.layer.pipe(Layer.provide(Database.layerRequestScoped))),
		Effect.provide(
			Layer.effect(
				Database.DatabaseConnection,
				Effect.acquireRelease(
					Effect.sync(() => Database.makeRequestConnection(connectionString)),
					(connection) => Effect.promise(() => connection.end()),
				),
			),
		),
		Effect.withSpan("BotGateway.authenticate"),
	)
