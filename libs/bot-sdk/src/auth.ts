import { HttpApiClient } from "effect/http-api"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { HazelApi } from "@hazel/domain/http"
import { Layer, Context, Duration, Effect, Schedule } from "effect"
import { AuthenticationError } from "./errors.ts"

/**
 * Bot authentication context
 */
export interface BotAuthContext {
	/**
	 * Bot ID
	 */
	readonly botId: string

	/**
	 * Human-readable bot name (for logging)
	 */
	readonly botName: string

	/**
	 * User ID associated with this bot (used as authorId for messages)
	 */
	readonly userId: string

	/**
	 * Channel IDs the bot has access to
	 */
	readonly channelIds: readonly string[]

	/**
	 * Bot token
	 */
	readonly token: string
}

/**
 * Service for bot authentication
 */
export class BotAuth extends Context.Service<BotAuth>()("BotAuth", {
	make: Effect.fn(function* (context: BotAuthContext) {
		return {
			getContext: Effect.succeed(context),

			validateToken: (token: string) =>
				Effect.gen(function* () {
					if (token !== context.token) {
						return yield* Effect.fail(
							new AuthenticationError({
								message: "Invalid bot token",
								cause: "Token does not match",
							}),
						)
					}
					return true
				}),
		}
	}),
}) {
	static readonly layer = (context: BotAuthContext) => Layer.effect(this, this.make(context))
}

/**
 * Helper to create auth context from bot token by calling the backend API
 * This validates the token and retrieves the real bot ID.
 * Retries with exponential backoff if the backend is not yet available.
 */
export const createAuthContextFromToken = (
	token: string,
	backendUrl: string,
): Effect.Effect<BotAuthContext, AuthenticationError> =>
	Effect.gen(function* () {
		yield* Effect.logDebug(`Waiting for backend at ${backendUrl}...`)

		// Create typed HttpApiClient with Bearer token auth
		const client = yield* HttpApiClient.make(HazelApi, {
			baseUrl: backendUrl,
			transformClient: (httpClient) =>
				httpClient.pipe(HttpClient.mapRequest(HttpClientRequest.bearerToken(token))),
		})

		// Call /bot-commands/me to validate token and get bot info
		// Retry with exponential backoff until backend is available
		const response = yield* client["bot-commands"].getBotMe().pipe(
			Effect.retry(
				Schedule.exponential("1 second", 2).pipe(
					Schedule.jittered,
					Schedule.while((metadata) =>
						Duration.isLessThanOrEqualTo(metadata.output, Duration.seconds(30)),
					),
				),
			),
			Effect.mapError(
				(error) =>
					new AuthenticationError({
						message: "Failed to authenticate bot",
						cause: String(error),
					}),
			),
		)

		yield* Effect.log(`Bot authenticated: ${response.name} (${response.botId})`)

		return {
			botId: response.botId,
			botName: response.name,
			userId: response.userId,
			channelIds: [],
			token,
		}
	}).pipe(Effect.provide(FetchHttpClient.layer))
