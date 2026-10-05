import { HttpApiBuilder } from "effect/http-api"
import { HttpServerRequest } from "effect/http"
import { BotRepo } from "@hazel/backend-core"
import { InvalidBearerTokenError, UnauthorizedError } from "@hazel/domain"
import { ValidateBotTokenResponse } from "@hazel/domain/http"
import { Config, Effect, Option } from "effect"
import { HazelApi } from "../api"

/**
 * Hash a token using SHA-256 (Web Crypto API)
 */
async function hashToken(token: string): Promise<string> {
	const encoder = new TextEncoder()
	const data = encoder.encode(token)
	const hashBuffer = await crypto.subtle.digest("SHA-256", data)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

export const HttpInternalLive = HttpApiBuilder.group(HazelApi, "internal", (handlers) =>
	handlers.handle("validateBotToken", ({ payload }) =>
		Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest

			// Optionally verify internal secret for server-to-server auth
			const internalSecretOption = yield* Effect.orDie(
				Config.String("INTERNAL_SECRET").pipe(Config.option),
			)
			const internalSecret = Option.getOrUndefined(internalSecretOption)

			if (internalSecret) {
				const providedSecret = request.headers["x-internal-secret"]
				if (providedSecret !== internalSecret) {
					return yield* Effect.fail(
						new UnauthorizedError({
							message: "Invalid internal secret",
							detail: "X-Internal-Secret header is missing or invalid",
						}),
					)
				}
			}

			const { token } = payload

			// Validate token format
			if (!token.startsWith("hzl_bot_")) {
				return yield* Effect.fail(
					new InvalidBearerTokenError({
						message: "Invalid token format",
						detail: "Expected bot token starting with hzl_bot_",
					}),
				)
			}

			// Hash the token
			const tokenHash = yield* Effect.promise(() => hashToken(token))

			// Find bot by token hash
			const botRepo = yield* BotRepo
			const botOption = yield* botRepo.findByTokenHash(tokenHash).pipe(
				Effect.catchTag("DatabaseError", () =>
					Effect.fail(
						new InvalidBearerTokenError({
							message: "Failed to validate bot token",
							detail: "Database error",
						}),
					),
				),
			)

			if (Option.isNone(botOption)) {
				return yield* Effect.fail(
					new InvalidBearerTokenError({
						message: "Invalid bot token",
						detail: "No bot found with this token",
					}),
				)
			}

			const bot = botOption.value

			// Return the bot identity for actor authentication
			return new ValidateBotTokenResponse({
				userId: bot.userId,
				botId: bot.id,
				organizationId: null, // Bot's org is determined by where it's installed, not stored on the bot itself
				scopes: bot.scopes,
			})
		}),
	),
)
