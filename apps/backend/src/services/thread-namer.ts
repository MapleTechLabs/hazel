/**
 * Names a thread from its conversation with a small model on OpenRouter (the cluster's
 * `ThreadNamingWorkflow`, rehomed). Called by the thread's `ChannelObject` from its outbox
 * (`worker/objects/effects/ai-effects.ts`); `OPENROUTER_API_KEY` unset disables it.
 */
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
const MODEL = "anthropic/claude-3.5-haiku"
const MAX_NAME_LENGTH = 50

export class ThreadNamingError extends Schema.TaggedError<ThreadNamingError>()("ThreadNamingError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

export interface ThreadLine {
	readonly author: string
	readonly content: string
}

export interface ThreadNamingContext {
	/** The message the thread was started from, when the thread's object knows it. */
	readonly original: ThreadLine | null
	readonly replies: ReadonlyArray<ThreadLine>
}

const NAMING_PROMPT = `You are a helpful assistant that generates concise, descriptive thread names.
Based on the conversation below, generate a short thread name (3-6 words max) that captures the main topic.
The name should be descriptive but brief, like a subject line.

Do not use quotes, colons, or special formatting. Just return the plain thread name.

Original message that started the thread:
Author: {originalAuthor}
Content: {originalContent}

Thread replies:
{threadMessages}

Generate a concise thread name:`

export const threadNamingPrompt = (context: ThreadNamingContext): string => {
	const replies = context.replies.map((line) => `${line.author}: ${line.content}`).join("\n")
	return NAMING_PROMPT.replace("{originalAuthor}", context.original?.author ?? "(unknown)")
		.replace("{originalContent}", context.original?.content ?? "(not available)")
		.replace("{threadMessages}", replies || "(no replies yet)")
}

/** The model's answer as a channel name: unquoted, at most 50 characters, never empty. */
export const cleanThreadName = (text: string): string => {
	const name = text.trim().replace(/^["']|["']$/g, "")
	if (name.length === 0) return "Discussion"
	return name.length > MAX_NAME_LENGTH ? `${name.substring(0, MAX_NAME_LENGTH - 3)}...` : name
}

const Completion = Schema.Struct({
	choices: Schema.Array(
		Schema.Struct({ message: Schema.Struct({ content: Schema.NullOr(Schema.String) }) }),
	),
})

export class ThreadNamer extends Context.Service<
	ThreadNamer,
	{
		/** The thread's name, or none when naming is not configured. */
		readonly name: (
			context: ThreadNamingContext,
		) => Effect.Effect<Option.Option<string>, ThreadNamingError>
	}
>()("@hazel/backend/ThreadNamer") {
	/** OpenRouter over the ambient `HttpClient`; the key is read from config once. */
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient
			const apiKey = yield* Config.option(Config.Redacted("OPENROUTER_API_KEY")).pipe(
				Effect.orElseSucceed(() => Option.none()),
			)
			const referrer = yield* Config.String("APP_URL").pipe(
				Config.withDefault("https://app.hazel.sh"),
				Effect.orElseSucceed(() => "https://app.hazel.sh"),
			)

			const name = Effect.fn("ThreadNamer.name")(function* (context: ThreadNamingContext) {
				if (Option.isNone(apiKey)) {
					yield* Effect.logWarning("OPENROUTER_API_KEY is not set; threads are not named")
					return Option.none<string>()
				}
				const request = HttpClientRequest.post(OPENROUTER_URL).pipe(
					HttpClientRequest.bearerToken(Redacted.value(apiKey.value)),
					HttpClientRequest.setHeaders({ "HTTP-Referer": referrer, "X-Title": "Hazel" }),
					HttpClientRequest.bodyJsonUnsafe({
						model: MODEL,
						max_tokens: 200,
						temperature: 0.3,
						messages: [{ role: "user", content: threadNamingPrompt(context) }],
					}),
				)
				const completion = yield* client.execute(request).pipe(
					Effect.flatMap(HttpClientResponse.filterStatusOk),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(Completion)),
					Effect.catchTags({
						HttpClientError: (cause) =>
							Effect.fail(
								new ThreadNamingError({ message: "OpenRouter request failed", cause }),
							),
						SchemaError: (cause) =>
							Effect.fail(
								new ThreadNamingError({ message: "Unexpected OpenRouter answer", cause }),
							),
					}),
				)
				const generated = cleanThreadName(completion.choices[0]?.message.content ?? "")
				yield* Effect.annotateCurrentSpan({ "thread.generated_name": generated })
				return Option.some(generated)
			})

			return { name }
		}),
	)
}
