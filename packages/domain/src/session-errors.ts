import { Schema } from "effect"

// 401 Errors - Client needs to re-authenticate
export class SessionNotProvidedError extends Schema.TaggedError<SessionNotProvidedError>(
	"SessionNotProvidedError",
)(
	"SessionNotProvidedError",
	{
		message: Schema.String,
		detail: Schema.String,
	},
	{ httpApiStatus: 401 },
) {}

export class InvalidBearerTokenError extends Schema.TaggedError<InvalidBearerTokenError>(
	"InvalidBearerTokenError",
)(
	"InvalidBearerTokenError",
	{
		message: Schema.String,
		detail: Schema.String,
	},
	{ httpApiStatus: 401 },
) {}

// 503 Errors - Infrastructure/Service issues (client can retry)
export class SessionLoadError extends Schema.TaggedError<SessionLoadError>("SessionLoadError")(
	"SessionLoadError",
	{
		message: Schema.String,
		detail: Schema.String,
	},
	{ httpApiStatus: 503 },
) {}

