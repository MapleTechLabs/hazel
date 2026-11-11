#!/usr/bin/env bun

/**
 * Simple Echo Bot Example
 *
 * This example demonstrates the basic usage of the @hazel-chat/bot-sdk.
 * It listens for new messages and responds with an echo.
 *
 * Features demonstrated:
 * - Bot authentication
 * - Connecting to the Hazel bot gateway for real-time events
 * - Listening for message events
 * - Sending messages via RPC
 * - Typesafe slash commands with /echo
 * - Error handling
 * - Graceful shutdown
 */

import { Effect, Schema } from "effect"
import { Command, CommandGroup, createHazelBot, HazelBotClient } from "../../src/hazel-bot-sdk.ts"

/**
 * Validate that required environment variables are present
 */
const botToken = process.env.BOT_TOKEN
if (!botToken) {
	console.error("Error: BOT_TOKEN environment variable is required")
	console.error("Please copy .env.example to .env and fill in your bot token")
	process.exit(1)
}

/**
 * Define typesafe slash commands using Command.make
 * Each command has a name, description, and optional typed arguments
 */
const EchoCommand = Command.make("echo", {
	description: "Echo back a message",
	args: {
		text: Schema.String,
	},
	usageExample: "/echo Hello world!",
})

const PingCommand = Command.make("ping", {
	description: "Check if the bot is alive XD",
	usageExample: "/ping",
})

// Group commands together for type inference
const commands = CommandGroup.make(EchoCommand, PingCommand)

/**
 * Create a Hazel bot runtime
 * All Hazel domain schemas are pre-configured automatically!
 * No need to define subscriptions - inbound events arrive over the gateway websocket.
 *
 * Configuration options:
 * - backendUrl: Backend API URL for short request/response bot APIs (defaults to https://api.hazel.sh)
 * - gatewayUrl: Gateway URL for inbound websocket delivery (defaults to backendUrl)
 * - botToken: Your bot's authentication token (required)
 * - commands: Typesafe CommandGroup for slash commands (optional)
 */
const runtime = createHazelBot({
	botToken,
	// For local development, override the URLs:
	backendUrl: process.env.BACKEND_URL ?? "http://localhost:3003",
	gatewayUrl: process.env.GATEWAY_URL ?? "http://localhost:3004",
	// Pass the typesafe command group
	commands,
})

/**
 * Define the bot program
 *
 * This is where you define what your bot does.
 * The program is an Effect that:
 * 1. Gets the BotClient from the context
 * 2. Registers event handlers
 * 3. Starts the bot
 * 4. Keeps running until interrupted
 */
const program = Effect.gen(function* () {
	// Get the HazelBotClient service from the Effect context
	const bot = yield* HazelBotClient

	// Log startup
	yield* Effect.log("Starting Simple Echo Bot...")

	// Register typesafe slash command handlers
	// Pass the command definition to get full type inference for ctx.args
	yield* bot.onCommand(EchoCommand, (ctx) =>
		Effect.gen(function* () {
			yield* Effect.log(`📨 Received /echo command from ${ctx.userId}`)
			// ctx.args.text is typed as string!
			yield* bot.message.send(ctx.channelId, `Echo: ${ctx.args.text}`).pipe(
				Effect.tap((msg) => Effect.log(`✅ Sent echo response: ${msg.id}`)),
				Effect.catch((error) => Effect.logError(`Failed to send echo: ${error}`)),
			)
		}),
	)

	yield* bot.onCommand(PingCommand, (ctx) =>
		Effect.gen(function* () {
			yield* Effect.log(`🏓 Received /ping command from ${ctx.userId}`)
			// ctx.args is typed as {} (empty object) since PingCommand has no args
			yield* bot.message.send(ctx.channelId, "Pong! 🏓").pipe(
				Effect.tap(() => Effect.log("✅ Sent pong response")),
				Effect.catch((error) => Effect.logError(`Failed to send pong: ${error}`)),
			)
		}),
	)

	// Register a handler for new messages using the convenient onMessage method
	// ✨ Type safety is AUTOMATIC - message parameter is typed as MessageType!
	yield* bot.onMessage((message) =>
		Effect.gen(function* () {
			// Log the message details
			yield* Effect.log("📨 New message received:")
			yield* Effect.log(`  Author ID: ${message.authorId}`)
			yield* Effect.log(`  Channel ID: ${message.channelId}`)
			yield* Effect.log(`  Content: ${message.content}`)
			yield* Effect.log(`  Created at: ${message.createdAt}`)

			// Don't respond to our own messages (prevent infinite loops)
			// You might want to check against your bot's user ID here
			if (message.content.startsWith("Echo:") || message.content.startsWith("Pong!")) {
				return
			}

			// Echo the message back using bot.message.reply
			yield* bot.message.reply(message, `Echo: ${message.content}`).pipe(
				Effect.tap((sentMessage) => Effect.log(`✅ Echoed message: ${sentMessage.id}`)),
				Effect.catch((error) => Effect.logError(`Failed to send echo: ${error}`)),
			)
		}),
	)

	// Example: React to messages containing "hello"
	yield* bot.onMessage((message) =>
		Effect.gen(function* () {
			if (message.content.toLowerCase().includes("hello")) {
				yield* bot.message.react(message, "👋").pipe(
					Effect.tap(() => Effect.log("👋 Waved at hello message")),
					Effect.catch((error) => Effect.logError(`Failed to react: ${error}`)),
				)
			}
		}),
	)

	// You can also register handlers for other events:
	// yield* bot.onChannelCreated((channel) => { ... })
	// yield* bot.onChannelMemberAdded((member) => { ... })

	// Start the bot (syncs commands to backend, begins listening for events)
	// This must be called after registering all handlers
	yield* bot.start

	yield* Effect.log("✅ Bot is now running and listening for messages!")
	yield* Effect.log("📝 Slash commands synced: /echo, /ping")
	yield* Effect.log("Press Ctrl+C to stop")

	// Keep the bot running
	// The bot will continue to process events until the program is interrupted
	return yield* Effect.never
})

/**
 * Handle graceful shutdown
 *
 * When the user presses Ctrl+C, we want to:
 * 1. Log that we're shutting down
 * 2. Let the Effect runtime clean up resources
 * 3. Exit cleanly
 */
const shutdown = Effect.gen(function* () {
	yield* Effect.log("\n👋 Shutting down bot...")
	yield* Effect.log("Cleaning up resources...")
	// The Effect runtime will automatically clean up resources
	// because we're running the program with Effect.scoped
	yield* Effect.sleep("100 millis")
	yield* Effect.log("✅ Shutdown complete")
	process.exit(0)
})

/**
 * Set up signal handlers for graceful shutdown
 */
process.on("SIGINT", () => {
	runtime.runFork(shutdown)
})

process.on("SIGTERM", () => {
	runtime.runFork(shutdown)
})

runtime.runPromise(program.pipe(Effect.scoped))
