import { Schema } from "effect"

export class StreamIdleTimeoutError extends Schema.TaggedError<StreamIdleTimeoutError>()(
	"StreamIdleTimeoutError",
	{
		message: Schema.String,
	},
) {}

export class DegenerateOutputError extends Schema.TaggedError<DegenerateOutputError>()(
	"DegenerateOutputError",
	{
		message: Schema.String,
		pattern: Schema.String,
		repeats: Schema.Number,
	},
) {}

export class IterationTimeoutError extends Schema.TaggedError<IterationTimeoutError>()(
	"IterationTimeoutError",
	{
		message: Schema.String,
	},
) {}

export class SessionTimeoutError extends Schema.TaggedError<SessionTimeoutError>()("SessionTimeoutError", {
	message: Schema.String,
}) {}
