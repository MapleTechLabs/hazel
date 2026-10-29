/**
 * Bot Runner
 *
 * Provides a simplified API for running Hazel bots with automatic:
 * - Environment configuration loading via Effect's Config
 * - Signal handling (SIGINT/SIGTERM) via BunRuntime.runMain
 * - Error logging and recovery
 * - Graceful shutdown
 */

import { BunRuntime } from "@effect/platform-bun"
import { Effect, Layer, Redacted, Context } from "effect"
import type { CommandGroup, EmptyCommands } from "./command.ts"
import { createHazelBot, HazelBotClient, type HazelBotConfig } from "./hazel-bot-sdk.ts"
import { BotEnvConfig } from "./bot-config.ts"

/**
 * Configuration for runBot
 */
export interface RunBotConfig<Commands extends CommandGroup<any> = EmptyCommands> {
	/**
	 * Commands this bot supports
	 */
	readonly commands?: Commands

	/**
	 * Enable @mention handling. When true, the bot registers as mentionable
	 * and triggers onMention handlers when users @ the bot in messages.
	 * @default false
	 */
	readonly mentionable?: boolean

	/**
	 * Health check server port. Set to `false` to disable.
	 * @default 9090 (or PORT env var)
	 */
	readonly healthPort?: number | false

	/**
	 * Additional layers to provide to the bot program.
	 * These are merged and provided to the setup function.
	 */
	readonly layers?: readonly Layer.Layer<any, any, any>[]

	/**
	 * Setup function that configures the bot.
	 * Receives the HazelBotClient and should register handlers.
	 * Does NOT need to call bot.start - that's handled automatically.
	 */
	readonly setup: (
		bot: Context.Service.Shape<typeof HazelBotClient>,
	) => Effect.Effect<void, unknown, unknown>

	/**
	 * Optional override for bot configuration.
	 * By default, reads from environment variables.
	 */
	readonly config?: Partial<Omit<HazelBotConfig<Commands>, "commands">>

	/**
	 * Service name for tracing (defaults to bot name, lowercase, hyphenated)
	 */
	readonly serviceName?: string
}

/**
 * Run a Hazel bot with automatic configuration, error handling, and lifecycle management
 *
 * This function:
 * 1. Reads and validates configuration from environment variables using Effect's Config
 * 2. Creates the bot runtime with all necessary layers
 * 3. Registers your handlers via the setup function
 * 4. Starts the bot and keeps it running
 * 5. Handles graceful shutdown on SIGINT/SIGTERM (via BunRuntime.runMain)
 *
 * @example
 * ```typescript
 * import { Effect, Schema } from "effect"
 * import { Command, CommandGroup, runHazelBot } from "@hazel/bot-sdk"
 *
 * const EchoCommand = Command.make("echo", {
 *   description: "Echo text back",
 *   args: { text: Schema.String },
 * })
 *
 * runHazelBot({
 *   commands: CommandGroup.make(EchoCommand),
 *   setup: (bot) => Effect.gen(function* () {
 *     yield* bot.onCommand(EchoCommand, (ctx) =>
 *       bot.message.send(ctx.channelId, `Echo: ${ctx.args.text}`)
 *     )
 *   }),
 * })
 * ```
 */
export const runHazelBot = <Commands extends CommandGroup<any> = EmptyCommands>(
	options: RunBotConfig<Commands>,
): void => {
	const program = Effect.gen(function* () {
		// Load configuration from environment
		const envConfig = yield* BotEnvConfig

		// Create runtime configuration
		const botConfig: HazelBotConfig<Commands> = {
			botToken: Redacted.value(envConfig.botToken),
			backendUrl: options.config?.backendUrl ?? envConfig.backendUrl,
			gatewayUrl: options.config?.gatewayUrl ?? envConfig.gatewayUrl,
			commands: options.commands,
			mentionable: options.mentionable,
			healthPort: options.healthPort ?? envConfig.healthPort,
			serviceName: options.serviceName ?? "hazel-bot",
			resumeOffset: options.config?.resumeOffset,
			sessionStore: options.config?.sessionStore,
			stateStore: options.config?.stateStore,
			maxConcurrentPartitions: options.config?.maxConcurrentPartitions,
			heartbeatIntervalMs: options.config?.heartbeatIntervalMs,
		}

		// Create the bot runtime
		const runtime = createHazelBot(botConfig)

		// Compose additional layers if provided
		const additionalLayers =
			options.layers && options.layers.length > 0
				? Layer.mergeAll(
						...(options.layers as [Layer.Layer<any, any, any>, ...Layer.Layer<any, any, any>[]]),
					)
				: Layer.empty

		// Create the bot program
		const botProgram = Effect.gen(function* () {
			const bot = yield* HazelBotClient

			// Run user's setup function
			yield* options.setup(bot)

			// Start the bot
			yield* bot.start

			// Keep running until interrupted
			return yield* Effect.never
		})

		// Run with layers provided
		return yield* Effect.promise(() =>
			runtime.runPromise(botProgram.pipe(Effect.scoped, Effect.provide(additionalLayers))),
		)
	}).pipe(
		// Handle config errors with helpful messages
		Effect.catchTag("ConfigError", (error) =>
			Effect.gen(function* () {
				yield* Effect.logError("Configuration error - please check your .env file")
				yield* Effect.logError(`Details: ${error.message}`)
				return yield* Effect.fail(error)
			}),
		),
	)

	// Run with BunRuntime which handles SIGINT/SIGTERM automatically
	BunRuntime.runMain(program)
}
