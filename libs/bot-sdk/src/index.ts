/**
 * @hazel-chat/bot-sdk
 *
 * Effect-based SDK for building bots that interact with Hazel over the bot gateway websocket
 *
 * ## Quick Start (Hazel Integrations)
 *
 * For building Hazel chat app integrations, use the HazelBotSDK:
 *
 * ```typescript
 * import { createHazelBot, HazelBotClient } from "@hazel-chat/bot-sdk"
 *
 * const runtime = createHazelBot({
 *   botToken: process.env.BOT_TOKEN!,
 *   gatewayUrl: process.env.GATEWAY_URL!,
 * })
 *
 * const program = Effect.gen(function* () {
 *   const bot = yield* HazelBotClient
 *   yield* bot.onMessage((message) => {
 *     console.log("New message:", message.content)
 *   })
 *   yield* bot.start
 * })
 * ```
 *
 */
export * from "./auth.ts"
export * from "./command.ts"
export * from "./config.ts"
export * from "./errors.ts"
export * from "./log-config.ts"
export * from "./log-context.ts"
export * from "./retry.ts"
export * from "./gateway.ts"
export * from "./runtime.ts"
// Hazel-specific convenience layer (recommended for Hazel integrations)
export * from "./hazel-bot-sdk.ts"
// Bot runner helper (simplified entry point)
export * from "./bot-config.ts"
export * from "./run-bot.ts"
// RPC client for API calls
export * from "./rpc/index.ts"
// Streaming for real-time message updates and AI streaming
export * from "./streaming/index.ts"
// Integration tools for dynamic tool building based on enabled integrations
export * from "./integration-tools/index.ts"
