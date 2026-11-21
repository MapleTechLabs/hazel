import { Schema } from "effect"

// 401 Errors - Client needs to re-authenticate
export class SessionNotProvidedError extends Schema.TaggedError<
	SessionNotProvidedError,
	{ readonly brand: unique symbol }
>()(
	"SessionNotProvidedError",
	{
		message: Schema.String,
		detail: Schema.String,
	},
	{ httpApiStatus: 401 },
) {}

export class InvalidBearerTokenError extends Schema.TaggedError<
	InvalidBearerTokenError,
	{ readonly brand: unique symbol }
>()(
	"InvalidBearerTokenError",
	{
		message: Schema.String,
		detail: Schema.String,
	},
	{ httpApiStatus: 401 },
) {}

// 503 Errors - Infrastructure/Service issues (client can retry)
export class SessionLoadError extends Schema.TaggedError<
	SessionLoadError,
	{ readonly brand: unique symbol }
>()(
	"SessionLoadError",
	{
		message: Schema.String,
		detail: Schema.String,
	},
	{ httpApiStatus: 503 },
) {}
