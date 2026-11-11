import { LanguageModel } from "effect/ai"
import {
	generateIntegrationInstructions,
	type AIContentChunk,
	type HazelBotClient,
} from "@hazel-chat/bot-sdk"
import type { ChannelId, OrganizationId } from "@hazel/schema"
import { Cause, Config, Duration, Effect, Exit, Ref, Stream } from "effect"

import { SessionTimeoutError } from "./errors.ts"
import { streamAgentLoop } from "./agent-loop.ts"
import { makeOpenRouterModel } from "./openrouter.ts"
import { INTEGRATION_INSTRUCTIONS, buildSystemPrompt } from "./prompt.ts"
import { mapEffectPartToChunk } from "./stream.ts"
import { buildToolkit } from "./tools/toolkit.ts"

const mapErrorToUserMessage = (error: unknown): string => {
	if (typeof error === "object" && error !== null && "_tag" in error) {
		switch ((error as { _tag: string })._tag) {
			case "SessionTimeoutError":
				return "The response took too long and was stopped."
			case "IterationTimeoutError":
				return "The AI took too long to respond. Please try again."
			case "StreamIdleTimeoutError":
				return "The AI stopped responding. Please try again."
			case "DegenerateOutputError":
				return "The AI got stuck in a loop. Please try rephrasing."
		}
	}
	return `An error occurred: ${String(error)}`
}

/**
 * Shared AI pipeline used by both /ask command and @mention handler.
 * Creates a streaming AI session in the given channel and runs the agent loop.
 */
export const handleAIRequest = (params: {
	bot: HazelBotClient["Service"]
	message: string
	channelId: ChannelId
	orgId: OrganizationId
	history?: Array<{ role: "user" | "assistant"; content: string }>
}) =>
	Effect.gen(function* () {
		const { bot, message, channelId, orgId } = params

		const enabledIntegrations = yield* (bot as any).integration.getEnabled(orgId)

		yield* Effect.log(`Enabled integrations for org ${orgId}:`, {
			integrations: Array.from(enabledIntegrations),
		})

		const modelName = yield* Config.String("AI_MODEL").pipe(Config.withDefault("moonshotai/kimi-k2.5"))

		// Generate dynamic instructions based on enabled integrations
		const integrationInstructions = generateIntegrationInstructions(
			enabledIntegrations,
			INTEGRATION_INSTRUCTIONS,
		)
		const systemInstructions = buildSystemPrompt(integrationInstructions)

		// Build prompt (with optional conversation history)
		const prompt = params.history
			? [
					{ role: "system" as const, content: systemInstructions },
					...params.history.map((m) => ({
						role: m.role as "user" | "assistant",
						content: m.content,
					})),
				]
			: [
					{ role: "system" as const, content: systemInstructions },
					{ role: "user" as const, content: message },
				]

		// Build toolkit with Effect-native handlers (resolved WithHandler)
		const toolkit = yield* buildToolkit({ bot, orgId, enabledIntegrations })

		// Use acquireUseRelease for guaranteed cleanup of the streaming session.
		yield* Effect.acquireUseRelease(
			(bot as any).ai.stream(channelId, {
				model: modelName,
				showThinking: true,
				showToolCalls: true,
				loading: {
					text: "Thinking...",
					icon: "sparkle",
					throbbing: true,
				},
			}),
			(session: any) =>
				Effect.gen(function* () {
					yield* Effect.log(`Created streaming message ${session.messageId}`)

					// Deduplicate reasoning deltas that the OpenRouter adapter emits
					// twice (from both delta.reasoning and delta.reasoning_details)
					const lastThinkingDelta = yield* Ref.make("")

					yield* streamAgentLoop({ prompt, toolkit }).pipe(
						Stream.map(mapEffectPartToChunk),
						Stream.filter((chunk): chunk is AIContentChunk => chunk !== null),
						Stream.filterEffect((chunk) => {
							if (chunk.type !== "thinking" || chunk.text.length === 0) {
								return Ref.set(lastThinkingDelta, "").pipe(Effect.as(true))
							}
							return Ref.getAndSet(lastThinkingDelta, chunk.text).pipe(
								Effect.map((prev) => prev !== chunk.text),
							)
						}),
						Stream.runForEach((chunk) => session.processChunk(chunk)),
					)

					yield* session.complete()
					yield* Effect.log(`Agent response complete: ${session.messageId}`)
				}).pipe(
					Effect.timeoutOrElse({
						orElse: () =>
							Effect.fail(
								new SessionTimeoutError({
									message: "Overall AI session exceeded 3 minute time limit",
								}),
							),
						duration: Duration.minutes(3),
					}),
				),
			// Release: on failure/interrupt, persist the error state
			(session: any, exit) =>
				Exit.isSuccess(exit)
					? Effect.void
					: Effect.gen(function* () {
							const cause = exit.cause
							yield* Effect.logError("Agent streaming failed", { error: cause })

							// Extract a user-facing message from the cause
							const failReason = cause.reasons.find(Cause.isFailReason)
							const dieReason = cause.reasons.find(Cause.isDieReason)
							const interruptReason = cause.reasons.find(Cause.isInterruptReason)

							let userMessage: string
							if (failReason) {
								userMessage = mapErrorToUserMessage(failReason.error)
							} else if (dieReason) {
								userMessage = "An unexpected error occurred."
							} else if (interruptReason) {
								userMessage = "Request was cancelled."
							} else if (cause.reasons.length === 0) {
								userMessage = "Request was cancelled."
							} else {
								userMessage = "An unexpected error occurred."
							}

							yield* session.fail(userMessage).pipe(Effect.ignore)
						}),
		)
	}).pipe(
		// Provide the LanguageModel dynamically based on config
		Effect.provideServiceEffect(
			LanguageModel.LanguageModel,
			Effect.gen(function* () {
				const model = yield* Config.String("AI_MODEL").pipe(
					Config.withDefault("google/gemini-3-flash-preview"),
				)
				return yield* makeOpenRouterModel(model)
			}),
		),
	)
