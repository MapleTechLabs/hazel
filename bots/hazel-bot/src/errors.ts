import { Schema } from "effect"

export class StreamIdleTimeoutError extends Schema.TaggedError<
	StreamIdleTimeoutError,
	{ readonly brand: unique symbol }
>()("StreamIdleTimeoutError", {
	message: Schema.String,
}) {}

export class DegenerateOutputError extends Schema.TaggedError<
	DegenerateOutputError,
	{ readonly brand: unique symbol }
>()("DegenerateOutputError", {
	message: Schema.String,
	pattern: Schema.String,
	repeats: Schema.Finite,
}) {}

export class IterationTimeoutError extends Schema.TaggedError<
	IterationTimeoutError,
	{ readonly brand: unique symbol }
>()("IterationTimeoutError", {
	message: Schema.String,
}) {}

export class SessionTimeoutError extends Schema.TaggedError<
	SessionTimeoutError,
	{ readonly brand: unique symbol }
>()("SessionTimeoutError", {
	message: Schema.String,
}) {}
