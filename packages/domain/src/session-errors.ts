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

export class SessionAuthenticationError extends Schema.TaggedError<SessionAuthenticationError>(
	"SessionAuthenticationError",
)(
	"SessionAuthenticationError",
	{
		message: Schema.String,
		detail: Schema.String,
	},
	{ httpApiStatus: 401 },
) {}

export class InvalidJwtPayloadError extends Schema.TaggedError<InvalidJwtPayloadError>(
	"InvalidJwtPayloadError",
)(
	"InvalidJwtPayloadError",
	{
		message: Schema.String,
		detail: Schema.String,
	},
	{ httpApiStatus: 401 },
) {}

export class SessionExpiredError extends Schema.TaggedError<SessionExpiredError>("SessionExpiredError")(
	"SessionExpiredError",
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

export class SessionRefreshError extends Schema.TaggedError<SessionRefreshError>("SessionRefreshError")(
	"SessionRefreshError",
	{
		message: Schema.String,
		detail: Schema.String,
	},
	{ httpApiStatus: 401 },
) {}

export class ClerkUserFetchError extends Schema.TaggedError<ClerkUserFetchError>("ClerkUserFetchError")(
	"ClerkUserFetchError",
	{
		message: Schema.String,
		detail: Schema.String,
	},
	{ httpApiStatus: 503 },
) {}
