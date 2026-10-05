import { Schema } from "effect"

// Error types for bot user activities
export class BotUserQueryError extends Schema.TaggedError<BotUserQueryError>()("BotUserQueryError", {
	provider: Schema.String,
	message: Schema.String,
	cause: Schema.Unknown.pipe(Schema.optional),
}) {
	readonly retryable = true // Database errors are transient
}
