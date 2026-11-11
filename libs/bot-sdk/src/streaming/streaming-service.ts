/**
 * Streaming Service
 *
 * Core functions for creating and managing streaming sessions.
 * Provides both low-level StreamSession and high-level AIStreamSession.
 *
 * Following Effect best practices:
 * - Effect.fn for automatic tracing
 * - Stream.fromAsyncIterable instead of Effect.runPromise inside Effect
 * - Specific error types for each failure mode
 */

import type { ChannelId, MessageId } from "@hazel/schema"
import { Effect, Ref, Stream } from "effect"
import type { LiveAction } from "@hazel/domain/live"
import type { LiveStateClientService } from "./live-state-client.ts"
import { ActorOperationError, MessageCreateError, StreamProcessingError } from "./errors.ts"
import type {
	AIContentChunk,
	AIStreamOptions,
	CreateStreamOptions,
	LoadingState,
	StreamSession,
} from "./types.ts"

/**
 * Loading state configuration for message embeds
 */
export interface MessageEmbedLoadingState {
	readonly text?: string
	readonly icon?: "sparkle" | "brain"
	readonly showSpinner?: boolean
	readonly throbbing?: boolean
}

/**
 * Message creation function type - matches bot.message.send signature
 */
export type MessageCreateFn = (
	channelId: ChannelId,
	content: string,
	options?: {
		readonly replyToMessageId?: MessageId | null
		readonly threadChannelId?: ChannelId | null
		readonly embeds?:
			| readonly {
					readonly liveState?: {
						readonly enabled: true
						readonly loading?: MessageEmbedLoadingState
					}
			  }[]
			| null
	},
) => Effect.Effect<{ id: string; channelId?: string }, unknown, unknown>

/**
 * A StreamSession over one message's live state. `complete` and `fail` also make the live object
 * save the final snapshot into the message (unless `persistOnComplete: false`).
 */
const createSession = (
	messageId: MessageId,
	channelId: ChannelId,
	live: LiveStateClientService,
	options: { readonly persistOnComplete?: boolean } = {},
): StreamSession => {
	const write = (action: LiveAction) => live.write(messageId, channelId, action)
	const stepIdOf = (action: LiveAction) =>
		write(action).pipe(
			Effect.flatMap((result) =>
				result.stepId === null
					? Effect.fail(
							new ActorOperationError({
								operation: action._tag,
								message: `Live state operation returned no step: ${action._tag}`,
								cause: null,
							}),
						)
					: Effect.succeed(result.stepId),
			),
		)
	return {
		messageId,
		appendText: (text) => Effect.asVoid(write({ _tag: "AppendText", text })),
		setText: (text) => Effect.asVoid(write({ _tag: "SetText", text })),
		setProgress: (progress) => Effect.asVoid(write({ _tag: "SetProgress", progress })),
		setData: (data) => Effect.asVoid(write({ _tag: "SetData", data })),
		startThinking: () => stepIdOf({ _tag: "StartThinking" }),
		startToolCall: (toolName, toolInput) => stepIdOf({ _tag: "StartToolCall", toolName, toolInput }),
		updateStepContent: (stepId, content, append = false) =>
			Effect.asVoid(write({ _tag: "UpdateStepContent", stepId, content, append })),
		completeStep: (stepId, result) =>
			Effect.asVoid(
				write({
					_tag: "CompleteStep",
					stepId,
					...(result?.output === undefined ? {} : { output: result.output }),
					...(result?.error === undefined ? {} : { error: result.error }),
				}),
			),
		complete: (finalData) =>
			Effect.asVoid(
				write({
					_tag: "Complete",
					...(finalData === undefined ? {} : { data: finalData }),
					...(options.persistOnComplete === false ? { persist: false } : {}),
				}),
			),
		// A failure is always saved, so it survives a page refresh.
		fail: (error) => Effect.asVoid(write({ _tag: "Fail", error })),
	}
}

/**
 * Internal function to create a stream session with injected dependencies.
 * This avoids circular dependencies with HazelBotClient.
 *
 * Uses Effect.fn for tracing the session creation process.
 */
export const createStreamSessionInternal = Effect.fn("StreamSession.create")(function* (
	createMessage: MessageCreateFn,
	live: LiveStateClientService,
	channelId: ChannelId,
	options: CreateStreamOptions & { loading?: LoadingState } = {},
) {
	yield* Effect.annotateCurrentSpan("channelId", channelId)

	// Create message with live state enabled and loading configuration
	const message = yield* createMessage(channelId, "", {
		replyToMessageId: options.replyToMessageId,
		threadChannelId: options.threadChannelId,
		embeds: [{ liveState: { enabled: true, loading: options.loading } }],
	}).pipe(
		Effect.mapError(
			(e) =>
				new MessageCreateError({
					channelId,
					message: "Failed to create message with live state",
					cause: e,
				}),
		),
	)

	yield* Effect.annotateCurrentSpan("messageId", message.id)

	// The live object checks the message against the channel it was created in.
	const messageId = message.id as MessageId
	const messageChannelId = (message.channelId ?? channelId) as ChannelId
	yield* live.write(messageId, messageChannelId, { _tag: "Start", data: options.initialData ?? {} })
	return createSession(messageId, messageChannelId, live, { persistOnComplete: options.persistOnComplete })
})

/**
 * Internal function to create an AI stream session with injected dependencies.
 *
 * Uses Effect.fn for tracing and Stream.fromAsyncIterable for proper
 * Effect composition (no Effect.runPromise inside Effect).
 */
export const createAIStreamSessionInternal = Effect.fn("AIStreamSession.create")(function* (
	createMessage: MessageCreateFn,
	live: LiveStateClientService,
	channelId: ChannelId,
	options: AIStreamOptions = {},
) {
	// Add model to initial data if provided
	const initialData = {
		...options.initialData,
		...(options.model ? { model: options.model } : {}),
		...(options.showThinking !== undefined ? { showThinking: options.showThinking } : {}),
		...(options.showToolCalls !== undefined ? { showToolCalls: options.showToolCalls } : {}),
	}

	// Create base session with enriched initial data and loading configuration
	const baseSession = yield* createStreamSessionInternal(createMessage, live, channelId, {
		...options,
		initialData,
		loading: options.loading,
	})

	// Track active thinking/tool steps by their chunk IDs
	const activeStepsRef = yield* Ref.make<Map<string, string>>(new Map())

	/**
	 * Process a single AI content chunk.
	 * Uses Effect.fn for tracing each chunk type.
	 */
	const processChunk = Effect.fn("AIStreamSession.processChunk")(function* (chunk: AIContentChunk) {
		yield* Effect.annotateCurrentSpan("chunkType", chunk.type)
		const activeSteps = yield* Ref.get(activeStepsRef)

		switch (chunk.type) {
			case "text": {
				yield* baseSession.appendText(chunk.text)
				break
			}

			case "thinking": {
				if (options.showThinking === false) {
					// Skip thinking steps if disabled
					break
				}

				// Check if we have an active thinking step
				const existingStepId = activeSteps.get("thinking")

				if (existingStepId) {
					// Append to existing thinking step
					yield* baseSession.updateStepContent(existingStepId, chunk.text, true)

					// If complete, finish the step
					if (chunk.isComplete) {
						yield* baseSession.completeStep(existingStepId)
						yield* Ref.update(activeStepsRef, (map) => {
							const newMap = new Map(map)
							newMap.delete("thinking")
							return newMap
						})
					}
				} else {
					// Start a new thinking step
					const stepId = yield* baseSession.startThinking()
					yield* baseSession.updateStepContent(stepId, chunk.text, true)
					yield* Ref.update(activeStepsRef, (map) => {
						const newMap = new Map(map)
						newMap.set("thinking", stepId)
						return newMap
					})

					// If already complete, finish immediately
					if (chunk.isComplete) {
						yield* baseSession.completeStep(stepId)
						yield* Ref.update(activeStepsRef, (map) => {
							const newMap = new Map(map)
							newMap.delete("thinking")
							return newMap
						})
					}
				}
				break
			}

			case "tool_call": {
				if (options.showToolCalls === false) {
					// Skip tool calls if disabled
					break
				}

				// Start a new tool call step
				const stepId = yield* baseSession.startToolCall(chunk.name, chunk.input)
				// Store mapping from tool call ID to step ID
				yield* Ref.update(activeStepsRef, (map) => {
					const newMap = new Map(map)
					newMap.set(`tool:${chunk.id}`, stepId)
					return newMap
				})
				break
			}

			case "tool_result": {
				if (options.showToolCalls === false) {
					break
				}

				// Find the corresponding step
				const stepId = activeSteps.get(`tool:${chunk.toolCallId}`)
				if (stepId) {
					yield* baseSession.completeStep(stepId, {
						output: chunk.output,
						error: chunk.error,
					})
					yield* Ref.update(activeStepsRef, (map) => {
						const newMap = new Map(map)
						newMap.delete(`tool:${chunk.toolCallId}`)
						return newMap
					})
				}
				break
			}
		}
	})

	/**
	 * Process an async iterable of AI content chunks.
	 *
	 * Uses Stream.fromAsyncIterable for proper Effect composition
	 * instead of the anti-pattern of calling Effect.runPromise inside Effect.
	 */
	const processStream = (
		chunks: AsyncIterable<AIContentChunk>,
	): Effect.Effect<void, ActorOperationError | StreamProcessingError> =>
		Effect.gen(function* () {
			// Convert AsyncIterable to Effect Stream - proper Effect composition
			const stream = Stream.fromAsyncIterable(
				chunks,
				(error) =>
					new StreamProcessingError({
						message: "Failed to read from async iterable",
						cause: error,
					}),
			)

			// Process each chunk as an Effect using Stream.runForEach
			yield* Stream.runForEach(stream, (chunk) => processChunk(chunk))
		}).pipe(Effect.withSpan("AIStreamSession.processStream"))

	return {
		...baseSession,
		processChunk,
		processStream,
	}
})
