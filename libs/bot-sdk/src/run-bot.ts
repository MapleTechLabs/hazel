/**
 * Bot Runner
 *
 * Provides a simplified API for running Hazel bots with automatic:
 * - Environment configuration loading via Effect's Config
 * - Signal handling (SIGINT/SIGTERM) on Bun and Node
 * - Error logging and recovery
 * - Graceful shutdown
 */

import { Effect, Layer, Redacted, Context, Runtime } from "effect"
import type { CommandGroup, EmptyCommands } from "./command.ts"
import { createHazelBot, HazelBotClient, makeHazelBotLayer, type HazelBotConfig } from "./hazel-bot-sdk.ts"
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
 * 5. Handles graceful shutdown on SIGINT/SIGTERM
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
		const botConfig = yield* resolveBotConfig(options)

		// Create the bot runtime
		const runtime = createHazelBot(botConfig)

		// Run with layers provided
		return yield* Effect.promise(() =>
			runtime.runPromise(
				runSetup(options).pipe(Effect.scoped, Effect.provide(additionalLayers(options))),
			),
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

	runMain(program)
}

/**
 * Run a bot inside the current Effect context, which supplies logging, tracing and the
 * `ConfigProvider` its env is read from: the entry point for a host that owns those (a Durable
 * Object, see `@hazel-chat/bot-sdk/cloudflare`). Never returns; interrupt it to stop the bot.
 */
export const launchBot = <Commands extends CommandGroup<any> = EmptyCommands>(
	options: RunBotConfig<Commands>,
): Effect.Effect<never, unknown> =>
	Effect.gen(function* () {
		const botConfig = yield* resolveBotConfig(options)
		return yield* runSetup(options).pipe(
			Effect.scoped,
			Effect.provide(additionalLayers(options)),
			Effect.provide(makeHazelBotLayer(botConfig)),
		)
		// `setup` and `layers` are typed loosely (`unknown` requirements), as in `runHazelBot`.
	}) as Effect.Effect<never, unknown>

/** Configuration from the environment, overridden by `options.config`. */
const resolveBotConfig = <Commands extends CommandGroup<any>>(options: RunBotConfig<Commands>) =>
	Effect.gen(function* () {
		const envConfig = yield* BotEnvConfig
		return {
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
		} satisfies HazelBotConfig<Commands>
	})

const additionalLayers = (options: RunBotConfig<any>) =>
	options.layers && options.layers.length > 0
		? Layer.mergeAll(...(options.layers as [Layer.Layer<any, any, any>, ...Layer.Layer<any, any, any>[]]))
		: Layer.empty

/** Register the handlers, start the bot, and keep it running until interrupted. */
const runSetup = (options: RunBotConfig<any>) =>
	Effect.gen(function* () {
		const bot = yield* HazelBotClient
		yield* options.setup(bot)
		yield* bot.start
		return yield* Effect.never
	})

/** The process main for Bun and Node: SIGINT/SIGTERM interrupt the bot, failures exit non-zero. */
const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
	let receivedSignal = false
	const onSignal = () => {
		receivedSignal = true
		fiber.interruptUnsafe(fiber.id)
	}
	fiber.addObserver((exit) => {
		process.removeListener("SIGINT", onSignal)
		process.removeListener("SIGTERM", onSignal)
		teardown(exit, (code) => {
			if (receivedSignal || code !== 0) process.exit(code)
		})
	})
	process.on("SIGINT", onSignal)
	process.on("SIGTERM", onSignal)
})
