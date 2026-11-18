import { Headers } from "effect/http"
import { BotRepo, UserRepo } from "@hazel/backend-core"
import {
	CurrentUser,
	InvalidBearerTokenError,
	SessionLoadError,
	SessionNotProvidedError,
	UnauthorizedError,
} from "@hazel/domain"
import { Cause, Context, Effect, Layer, Option } from "effect"
import { AuthMiddleware } from "@hazel/domain/rpc"
import { type ApiScope, CurrentBotScopes, RequiredScopes } from "@hazel/domain/scopes"
import { AgentAccess, agentMayCallRpc, isAgentToken } from "../../services/agent-access"
import { HazelSession } from "../../services/hazel-session"
import { CurrentAgent } from "../../worker/objects/principal"

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

export const AuthMiddlewareLive = Layer.effect(
	AuthMiddleware,
	Effect.gen(function* () {
		const hazelSession = yield* HazelSession
		const botRepo = yield* BotRepo
		const userRepo = yield* UserRepo
		const agentAccess = yield* AgentAccess

		return AuthMiddleware.of((effect, { headers, rpc }) =>
			Effect.gen(function* () {
				// Hazel session cookie (browser). RPC calls are POSTs, so the Origin is checked.
				const authHeader = Headers.get(headers, "authorization")
				const hasBearer =
					Option.isSome(authHeader) &&
					authHeader.value.startsWith("Bearer ") &&
					authHeader.value.length > 7
				const cookieUser = yield* hazelSession
					.fromCookie(headers, "POST")
					.pipe(
						Effect.catchTag("InvalidBearerTokenError", (error) =>
							hasBearer ? Effect.succeedNone : Effect.fail(error),
						),
					)
				if (Option.isSome(cookieUser)) {
					return yield* Effect.provideService(effect, CurrentUser.Context, cookieUser.value)
				}

				// Bearer token: Hazel session credential (native clients) or bot token
				if (Option.isSome(authHeader) && authHeader.value.startsWith("Bearer ")) {
					const token = authHeader.value.slice(7)

					// Agent token (`AgentAccess`): the user it acts for, on the RPCs its scopes grant
					// (`customers:read`: the Customers reads); every other RPC is refused.
					if (isAgentToken(token)) {
						const agent = yield* agentAccess.authenticate(token).pipe(
							Effect.catchTag("DatabaseError", (error) =>
								Effect.logError("Agent token lookup failed", Cause.fail(error)).pipe(
									Effect.andThen(
										Effect.fail(
											new SessionLoadError({
												message: "Failed to validate agent token",
												detail: "The session store is unavailable",
											}),
										),
									),
								),
							),
						)
						if (Option.isNone(agent)) {
							return yield* Effect.fail(
								new InvalidBearerTokenError({
									message: "Invalid agent token",
									detail: "The token is invalid, expired or revoked",
								}),
							)
						}
						const required = Context.getOrElse(rpc.annotations, RequiredScopes, () => [])
						if (!agentMayCallRpc(agent.value.scopes, required)) {
							return yield* Effect.fail(
								new UnauthorizedError({
									message: "This token cannot call this method",
									detail: `${rpc._tag} is outside the token's scopes`,
								}),
							)
						}
						const user = yield* hazelSession.userOf(agent.value.userId)
						return yield* effect.pipe(
							Effect.provideService(CurrentUser.Context, user),
							Effect.provideService(CurrentAgent, {
								grantId: agent.value.grantId,
								name: agent.value.name,
							}),
						)
					}

					if (hazelSession.enabled && !token.startsWith("hzl_bot_")) {
						const sessionUser = yield* hazelSession.verify(token)
						if (Option.isSome(sessionUser)) {
							return yield* Effect.provideService(
								effect,
								CurrentUser.Context,
								sessionUser.value,
							)
						}
					}

					// Otherwise, treat as bot token (hash-based lookup; `bots` and `users` are the
					// directory's, and the Worker's `Database` is its D1)
					const tokenHash = yield* Effect.promise(() => hashToken(token))

					// Find bot by token hash
					const botOption = yield* botRepo.findByTokenHash(tokenHash).pipe(
						Effect.catchTag("DatabaseError", (error) =>
							Effect.logError("Bot token lookup failed", Cause.fail(error)).pipe(
								Effect.andThen(
									Effect.fail(
										new SessionLoadError({
											message: "Failed to validate bot token",
											detail: "The session store is unavailable",
										}),
									),
								),
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
						Effect.catchTag("DatabaseError", (error) =>
							Effect.logError("Bot token lookup failed", Cause.fail(error)).pipe(
								Effect.andThen(
									Effect.fail(
										new SessionLoadError({
											message: "Failed to validate bot token",
											detail: "The session store is unavailable",
										}),
									),
								),
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
