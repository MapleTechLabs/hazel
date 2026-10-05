import { Headers } from "effect/http"
import { BotRepo, UserRepo } from "@hazel/backend-core"
import { CurrentUser, InvalidBearerTokenError, SessionNotProvidedError } from "@hazel/domain"
import { Effect, Layer, Option } from "effect"
import { AuthMiddleware } from "@hazel/domain/rpc"
import { type ApiScope, CurrentBotScopes } from "@hazel/domain/scopes"
import { SessionManager } from "../../services/session-manager"

export { AuthMiddleware } from "@hazel/domain/rpc"

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

/**
 * Check if a token looks like a JWT (three base64url-encoded segments)
 */
function isJwtToken(token: string): boolean {
	const parts = token.split(".")
	return parts.length === 3 && parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))
}

export const AuthMiddlewareLive = Layer.effect(
	AuthMiddleware,
	Effect.gen(function* () {
		const sessionManager = yield* SessionManager
		const botRepo = yield* BotRepo
		const userRepo = yield* UserRepo

		return AuthMiddleware.of((effect, { headers }) =>
			Effect.gen(function* () {
				// Check for Bearer token first (bot SDK or desktop app authentication)
				const authHeader = Headers.get(headers, "authorization")

				if (Option.isSome(authHeader) && authHeader.value.startsWith("Bearer ")) {
					const token = authHeader.value.slice(7)

					// JWT → Clerk bearer auth. Otherwise, treat as bot token (hash lookup).
					if (isJwtToken(token)) {
						const currentUser = yield* sessionManager.authenticateWithBearer(token)
						return yield* Effect.provideService(effect, CurrentUser.Context, currentUser)
					}

					// Otherwise, treat as bot token (hash-based lookup)
					const tokenHash = yield* Effect.promise(() => hashToken(token))

					// Find bot by token hash
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

					const botApiScopes = new Set(bot.scopes ?? []) as ReadonlySet<ApiScope>

					// Get the bot's user from users table
					const userOption = yield* userRepo.findById(bot.userId).pipe(
						Effect.catchTag("DatabaseError", () =>
							Effect.fail(
								new InvalidBearerTokenError({
									message: "Failed to validate bot token",
									detail: "Database error",
								}),
							),
						),
					)
					if (Option.isNone(userOption)) {
						return yield* Effect.fail(
							new InvalidBearerTokenError({
								message: "Invalid bot token",
								detail: "Bot user not found",
							}),
						)
					}

					const user = userOption.value

					// Construct CurrentUser.Schema for the bot
					const botUser: CurrentUser.Schema = {
						id: user.id,
						email: user.email,
						firstName: user.firstName,
						lastName: user.lastName,
						avatarUrl: user.avatarUrl ?? undefined,
						role: "member",
						isOnboarded: true,
						timezone: user.timezone,
						organizationId: null,
						settings: user.settings,
					}

					return yield* Effect.provideService(
						Effect.provideService(effect, CurrentUser.Context, botUser),
						CurrentBotScopes,
						Option.some(botApiScopes),
					)
				}

				// No valid authentication provided
				return yield* Effect.fail(
					new SessionNotProvidedError({
						message: "No authentication provided",
						detail: "Bearer token required",
					}),
				)
			}),
		)
	}),
)
