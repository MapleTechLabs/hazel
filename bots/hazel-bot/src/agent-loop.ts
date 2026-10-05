import { AiError, LanguageModel, Prompt, type Response, type Toolkit } from "effect/ai"
import { Cause, Duration, Effect, Queue, Stream } from "effect"

import { withDegenerationDetection } from "./degeneration-detector.ts"
import { DegenerateOutputError, IterationTimeoutError, StreamIdleTimeoutError } from "./errors.ts"

const MAX_ITERATIONS = 10
const IDLE_TIMEOUT = Duration.seconds(15)
const ITERATION_TIMEOUT = Duration.minutes(2)

type AgentError = AiError.AiError | StreamIdleTimeoutError | IterationTimeoutError | DegenerateOutputError

/**
 * Multi-step streaming agent loop.
 *
 * The Effect AI SDK resolves tool calls in a single pass but does not loop back
 * to the model with results. This function implements the loop: if the model
 * calls tools, the results are appended to the prompt and the model is called
 * again, until it responds without tool calls or MAX_ITERATIONS is reached.
 *
 * All stream parts (text deltas, tool calls, tool results) from every iteration
 * are emitted in real-time via a Queue-backed stream.
 *
 * Safeguards per iteration:
 * - Idle timeout: fails if no chunk received for 15s (via stream timeout + concat fail)
 * - Degeneration detection: fails if repetitive patterns detected
 * - Iteration timeout: fails if a single LLM call exceeds 2 minutes
 */
export const streamAgentLoop = (options: {
	prompt: Prompt.RawInput
	toolkit: Toolkit.WithHandler<any>
}): Stream.Stream<Response.AnyPart, AgentError, LanguageModel.LanguageModel> =>
	Effect.gen(function* () {
		const queue: Queue.Queue<Response.AnyPart, AgentError | Cause.Done> = yield* Queue.make<
			Response.AnyPart,
			AgentError | Cause.Done
		>()

		yield* Effect.gen(function* () {
			let currentPrompt = Prompt.make(options.prompt)

			for (let i = 0; i < MAX_ITERATIONS; i++) {
				const collectedParts: Array<Response.AnyPart> = []

				yield* LanguageModel.streamText({
					prompt: currentPrompt,
					toolkit: options.toolkit,
					toolChoice: "auto" as any,
				}).pipe(
					// Idle timeout: ends the stream if no element arrives for 15s,
					// then we concat a failure stream so that timeout = error
					Stream.timeout(IDLE_TIMEOUT),
					Stream.concat(
						Stream.fail(
							new StreamIdleTimeoutError({
								message: "No data received from AI model for 15 seconds",
							}),
						),
					),
					// Degeneration detection: fails on repetitive patterns
					withDegenerationDetection,
					Stream.runForEach((part) => {
						collectedParts.push(part as Response.AnyPart)
						return Queue.offer(queue, part as Response.AnyPart)
					}),
					// Iteration timeout: wall-clock limit per LLM call
					Effect.timeoutOrElse({
						orElse: () =>
							Effect.fail(
								new IterationTimeoutError({
									message: "Single LLM call exceeded 2 minute time limit",
								}),
							),
						duration: ITERATION_TIMEOUT,
					}),
				)

				// If no tool calls were made, the model is done responding
				const hasToolCalls = collectedParts.some((p) => p.type === "tool-call")
				if (!hasToolCalls) break

				// Append assistant response + tool results to prompt for next iteration
				currentPrompt = Prompt.concat(currentPrompt, Prompt.fromResponseParts(collectedParts))
			}
		}).pipe(Queue.into(queue), Effect.forkScoped)

		return Stream.fromQueue(queue)
	}).pipe(Stream.unwrap) as Stream.Stream<Response.AnyPart, AgentError, LanguageModel.LanguageModel>
