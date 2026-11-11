/**
 * Streaming types for AI and real-time message updates
 *
 * Uses Effect Schema for serialization-ready types and specific error types
 * for type-safe error handling with catchTag/catchTags.
 */

import type { ChannelId, MessageId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import type { ActorOperationError, MessageCreateError, StreamProcessingError } from "./errors.ts"

/**
 * Options for creating a new stream session
 */
export interface CreateStreamOptions {
	/** Initial data to store in the actor state */
	readonly initialData?: Record<string, unknown>
	/** Reply to a specific message */
	readonly replyToMessageId?: MessageId | null
	/** Send message in a thread */
	readonly threadChannelId?: ChannelId | null
	/** Persist final text and state to database on complete (default: true) */
	readonly persistOnComplete?: boolean
}

/**
 * A low-level stream session for managing real-time message updates.
 * Provides direct access to actor methods with Effect wrappers.
 *
 * All operations use ActorOperationError for consistent error handling.
 */
export interface StreamSession {
	/** The ID of the message being streamed */
	readonly messageId: MessageId

	/** Append text to the current stream */
	appendText(text: string): Effect.Effect<void, ActorOperationError>

	/** Replace all text in the stream */
	setText(text: string): Effect.Effect<void, ActorOperationError>

	/** Set progress (0-100) */
	setProgress(progress: number): Effect.Effect<void, ActorOperationError>

	/** Update arbitrary data fields */
	setData(data: Record<string, unknown>): Effect.Effect<void, ActorOperationError>

	/** Start a thinking step (returns step ID) */
	startThinking(): Effect.Effect<string, ActorOperationError>

	/** Start a tool call step (returns step ID) */
	startToolCall(name: string, input: Record<string, unknown>): Effect.Effect<string, ActorOperationError>

	/** Update step content (for streaming thinking/text) */
	updateStepContent(
		stepId: string,
		content: string,
		append?: boolean,
	): Effect.Effect<void, ActorOperationError>

	/** Complete a step with optional result */
	completeStep(
		stepId: string,
		result?: { output?: unknown; error?: string },
	): Effect.Effect<void, ActorOperationError>

	/** Mark the stream as completed */
	complete(finalData?: Record<string, unknown>): Effect.Effect<void, ActorOperationError, unknown>

	/** Mark the stream as failed */
	fail(error: string): Effect.Effect<void, ActorOperationError, unknown>
}

/**
 * Loading state configuration for AI streaming messages.
 * Controls the appearance of the loading indicator shown before streaming begins.
 */
export interface LoadingState {
	/** Text to display while loading (default: "Thinking...") */
	readonly text?: string
	/** Icon to display: "sparkle" or "brain" (default: "sparkle") */
	readonly icon?: "sparkle" | "brain"
	/** Whether to show spinning animation on the icon (default: true) */
	readonly showSpinner?: boolean
	/** Whether to pulse/throb the entire loading indicator (default: false) */
	readonly throbbing?: boolean
}

/**
 * Options for creating an AI stream session
 */
export interface AIStreamOptions extends CreateStreamOptions {
	/** Model identifier (for display purposes) */
	readonly model?: string
	/** Whether to show thinking steps in the UI */
	readonly showThinking?: boolean
	/** Whether to show tool calls in the UI */
	readonly showToolCalls?: boolean
	/** Loading state configuration for the initial loading indicator */
	readonly loading?: LoadingState
	// persistOnComplete is inherited from CreateStreamOptions
}

// ============================================================================
// Schema-based AI Content Chunk Types
// ============================================================================

/**
 * Text chunk - plain text content from the AI
 */
export const TextChunk = Schema.Struct({
	type: Schema.Literal("text"),
	text: Schema.String,
})
export type TextChunk = Schema.Schema.Type<typeof TextChunk>

/**
 * Thinking chunk - AI's internal reasoning (extended thinking)
 */
export const ThinkingChunk = Schema.Struct({
	type: Schema.Literal("thinking"),
	text: Schema.String,
	isComplete: Schema.optional(Schema.Boolean),
})
export type ThinkingChunk = Schema.Schema.Type<typeof ThinkingChunk>

/**
 * Tool call chunk - AI invoking a tool
 */
export const ToolCallChunk = Schema.Struct({
	type: Schema.Literal("tool_call"),
	id: Schema.String,
	name: Schema.String,
	input: Schema.Record(Schema.String, Schema.Unknown),
})
export type ToolCallChunk = Schema.Schema.Type<typeof ToolCallChunk>

/**
 * Tool result chunk - result from a tool execution
 */
export const ToolResultChunk = Schema.Struct({
	type: Schema.Literal("tool_result"),
	toolCallId: Schema.String,
	output: Schema.Unknown,
	error: Schema.optional(Schema.String),
})
export type ToolResultChunk = Schema.Schema.Type<typeof ToolResultChunk>

/**
 * AI content chunk types for processing streaming AI responses.
 *
 * Schema-based union type that can be used for:
 * - Type-safe runtime validation
 * - Serialization/deserialization
 * - API contracts
 *
 * @example
 * ```typescript
 * // Validate incoming chunk
 * const chunk = yield* Schema.decodeUnknown(AIContentChunk)(rawData)
 *
 * // Process with pattern matching
 * switch (chunk.type) {
 *   case "text": console.log(chunk.text); break
 *   case "thinking": console.log(chunk.text, chunk.isComplete); break
 *   case "tool_call": console.log(chunk.name, chunk.input); break
 *   case "tool_result": console.log(chunk.output); break
 * }
 * ```
 */
export const AIContentChunk = Schema.Union([TextChunk, ThinkingChunk, ToolCallChunk, ToolResultChunk])
export type AIContentChunk = Schema.Schema.Type<typeof AIContentChunk>

/**
 * An AI stream session extends StreamSession with AI-specific helpers
 * for processing chunks from AI model responses.
 *
 * Uses specific error types for each operation:
 * - ActorOperationError: For actor method failures
 * - StreamProcessingError: For async iterable processing failures
 */
export interface AIStreamSession extends StreamSession {
	/** Process a single AI content chunk */
	processChunk(chunk: AIContentChunk): Effect.Effect<void, ActorOperationError>

	/**
	 * Process an async iterable of AI content chunks.
	 *
	 * @example
	 * ```typescript
	 * const stream = yield* bot.ai.stream(channelId)
	 *
	 * // Process AI SDK stream
	 * yield* stream.processStream(aiResponse.textStream).pipe(
	 *   Effect.catchTag("StreamProcessingError", (err) =>
	 *     Effect.log(`Stream failed: ${err.message}`)
	 *   ),
	 *   Effect.catchTag("ActorOperationError", (err) =>
	 *     Effect.log(`Actor op failed: ${err.operation}`)
	 *   ),
	 * )
	 *
	 * yield* stream.complete()
	 * ```
	 */
	processStream(
		chunks: AsyncIterable<AIContentChunk>,
	): Effect.Effect<void, ActorOperationError | StreamProcessingError>
}

// ============================================================================
// Error type re-exports for convenience
// ============================================================================

/**
 * Union of all errors that can occur during stream session creation.
 * Useful for typing catch handlers.
 */
export type StreamSessionCreationError = MessageCreateError | ActorOperationError

/**
 * Union of all errors that can occur during AI stream processing.
 */
export type AIStreamProcessingError = ActorOperationError | StreamProcessingError
