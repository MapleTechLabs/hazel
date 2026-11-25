/**
 * OpenRouter's Decisions API (`POST /api/alpha/decisions`): a decision model (TypeSafe's Jev)
 * answers typed questions about a `state` with probabilities instead of text. It is not the chat
 * completions endpoint, and the model writes nothing: code branches on the numbers.
 *
 * Used for support triage (`worker/objects/customers/triage.ts`), from the object's outbox.
 * `OPENROUTER_API_KEY` unset disables it (`None`).
 */
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"
/** Pinned: probabilities differ between versions, and the thresholds were picked for this one. */
export const DECISION_MODEL = "typesafe/jev-1.14"
/** Under the outbox's delivery timeout (10 s), so a slow answer is this error, not a bare timeout. */
const REQUEST_TIMEOUT_MS = 8_000

export class DecisionsError extends Schema.TaggedError<DecisionsError, { readonly brand: unique symbol }>()(
	"DecisionsError",
	{
		message: Schema.String,
		/** False for an answer that will not change on a retry (a refused key, a bad request). */
		retryable: Schema.Boolean,
		cause: Schema.optional(Schema.Unknown),
	},
) {}

/** A yes/no question: `instructions` is the question (text, or an object holding it and its data). */
export interface NoulQuestion {
	readonly type: "noul"
	readonly instructions: unknown
	/** What a yes and a no mean, when the boundary needs saying. */
	readonly criteria?: { readonly true: string; readonly false: string }
}

export interface DecisionsRequest {
	/** What the questions are about: a string, or JSON with named parts. */
	readonly state: unknown
	/** By key: 1 to 64 of `A-Z a-z 0-9 _ -`. */
	readonly questions: Readonly<Record<string, NoulQuestion>>
}

/** P(yes) per question key; `null` for one the model refused, left out, or answered out of range. */
export type NoulAnswers = Readonly<Record<string, number | null>>

// Only what is read: answers of other types, and fields added later, pass.
const Answers = Schema.Struct({
	answers: Schema.Record(
		Schema.String,
		Schema.Struct({ type: Schema.String, noul: Schema.optional(Schema.Unknown) }),
	),
	usage: Schema.optional(
		Schema.Struct({
			input_tokens: Schema.optional(Schema.Finite),
			cost: Schema.optional(Schema.Finite),
		}),
	),
})

/** P(yes) of each asked question, from the response's `answers`. */
export const noulAnswersOf = (
	questions: DecisionsRequest["questions"],
	answers: (typeof Answers.Type)["answers"],
): NoulAnswers =>
	Object.fromEntries(
		Object.keys(questions).map((key) => {
			const answer = answers[key]
			const value = answer?.type === "noul" ? answer.noul : undefined
			return [key, typeof value === "number" && value >= 0 && value <= 1 ? value : null]
		}),
	)

export class Decisions extends Context.Service<
	Decisions,
	{
		/** The model's answers, or none when it is not configured. */
		readonly ask: (request: DecisionsRequest) => Effect.Effect<Option.Option<NoulAnswers>, DecisionsError>
	}
>()("@hazel/backend/Decisions") {
	/** OpenRouter over the ambient `HttpClient`; the key is read from config once. */
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient
			const apiKey = yield* Config.option(Config.Redacted("OPENROUTER_API_KEY")).pipe(
				Effect.orElseSucceed(() => Option.none()),
			)
			const referrer = yield* Config.String("FRONTEND_URL").pipe(
				Config.withDefault("https://app.hazel.sh"),
				Effect.orElseSucceed(() => "https://app.hazel.sh"),
			)

			const ask = Effect.fn("Decisions.ask")(
				function* (request: DecisionsRequest) {
					if (Option.isNone(apiKey)) return Option.none<NoulAnswers>()
					// The peer by name, so the provider is an edge on the service map.
					yield* Effect.annotateCurrentSpan({
						"decisions.model": DECISION_MODEL,
						"decisions.questions": Object.keys(request.questions).length,
						"peer.service": "openrouter",
						"server.address": new URL(DECISIONS_URL).host,
					})
					const response = yield* client
						.execute(
							HttpClientRequest.post(DECISIONS_URL).pipe(
								HttpClientRequest.bearerToken(Redacted.value(apiKey.value)),
								HttpClientRequest.setHeaders({
									"HTTP-Referer": referrer,
									"X-Title": "Hazel",
								}),
								HttpClientRequest.bodyJsonUnsafe({
									model: DECISION_MODEL,
									state: request.state,
									questions: request.questions,
								}),
							),
						)
						.pipe(
							Effect.catchTag("HttpClientError", (cause) =>
								Effect.fail(
									new DecisionsError({
										message: "OpenRouter request failed",
										retryable: true,
										cause,
									}),
								),
							),
						)
					if (response.status < 200 || response.status >= 300) {
						const body = yield* response.text.pipe(
							Effect.catchTag("HttpClientError", () => Effect.succeed("")),
						)
						return yield* new DecisionsError({
							message: `Decisions request failed (${response.status}): ${body.slice(0, 300)}`,
							// Rate limits and provider errors pass; a refused key or request does not.
							retryable: response.status === 429 || response.status >= 500,
						})
					}
					const decoded = yield* HttpClientResponse.schemaBodyJson(Answers)(response).pipe(
						Effect.catchTags({
							HttpClientError: (cause) =>
								Effect.fail(
									new DecisionsError({
										message: "OpenRouter answer could not be read",
										retryable: true,
										cause,
									}),
								),
							SchemaError: (cause) =>
								Effect.fail(
									new DecisionsError({
										message: "Unexpected Decisions answer",
										retryable: false,
										cause,
									}),
								),
						}),
					)
					yield* Effect.annotateCurrentSpan({
						"decisions.input_tokens": decoded.usage?.input_tokens ?? 0,
						"decisions.cost_usd": decoded.usage?.cost ?? 0,
					})
					return Option.some(noulAnswersOf(request.questions, decoded.answers))
				},
				Effect.timeoutOrElse({
					duration: REQUEST_TIMEOUT_MS,
					orElse: () =>
						Effect.fail(
							new DecisionsError({
								message: `No Decisions answer after ${REQUEST_TIMEOUT_MS}ms`,
								retryable: true,
							}),
						),
				}),
			)

			return { ask }
		}),
	)
}
