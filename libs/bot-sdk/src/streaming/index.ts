/**
 * Streaming module for real-time message updates and AI streaming
 *
 * @example Low-level streaming API
 * ```typescript
 * import { createStreamSession } from "@hazel-chat/bot-sdk"
 *
 * const stream = yield* createStreamSession(channelId)
 * yield* stream.appendText("Hello ")
 * yield* stream.startThinking()
 * yield* stream.complete()
 * ```
 *
 * @example High-level AI streaming API
 * ```typescript
 * import { createAIStreamSession } from "@hazel-chat/bot-sdk"
 *
 * const stream = yield* createAIStreamSession(channelId, { model: "claude-3.5-sonnet" })
 * yield* stream.processChunk({ type: "text", text: "Hello" })
 * yield* stream.complete()
 * ```
 *
 * @example Error handling with specific error types
 * ```typescript
 * yield* stream.appendText("Hello").pipe(
 *   Effect.catchTag("ActorOperationError", (err) =>
 *     Effect.log(`Actor op failed: ${err.operation}`)
 *   ),
 * )
 * ```
 */

// Types (including Schema-based chunk types)
export type {
	AIContentChunk,
	AIStreamOptions,
	AIStreamSession,
	AIStreamProcessingError,
	CreateStreamOptions,
	LoadingState,
	StreamSession,
	StreamSessionCreationError,
	TextChunk,
	ThinkingChunk,
	ToolCallChunk,
	ToolResultChunk,
} from "./types.ts"

// Schema exports for runtime validation
export {
	AIContentChunk as AIContentChunkSchema,
	TextChunk as TextChunkSchema,
	ThinkingChunk as ThinkingChunkSchema,
	ToolCallChunk as ToolCallChunkSchema,
	ToolResultChunk as ToolResultChunkSchema,
} from "./types.ts"

// Errors - specific error types for each failure mode
export {
	ActorConnectionError,
	ActorOperationError,
	BotNotConfiguredError,
	MessageCreateError,
	MessagePersistError,
	StreamProcessingError,
	type StreamingError,
} from "./errors.ts"

// Services
export {
	LiveStateClient,
	type LiveStateClientConfig,
	type LiveStateClientService,
	makeLiveStateClient,
} from "./live-state-client.ts"

// Core functions (internal - use bot.stream.create or bot.ai.stream instead)
export {
	createAIStreamSessionInternal,
	createStreamSessionInternal,
	type MessageCreateFn,
} from "./streaming-service.ts"
