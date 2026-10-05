import { Schema } from "effect"

/**
 * Error thrown when session cache operations fail
 */
export class SessionCacheError extends Schema.TaggedError<SessionCacheError>()("SessionCacheError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error thrown when user lookup cache operations fail
 */
export class UserLookupCacheError extends Schema.TaggedError<UserLookupCacheError>()("UserLookupCacheError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

/** Error thrown when fetching an organization from the identity provider fails. */
export class OrganizationFetchError extends Schema.TaggedError<OrganizationFetchError>()(
	"OrganizationFetchError",
	{
		message: Schema.String,
		detail: Schema.optional(Schema.String),
	},
) {}

/** Error thrown when creating an organization in the identity provider fails. */
export class OrganizationCreateError extends Schema.TaggedError<OrganizationCreateError>()(
	"OrganizationCreateError",
	{
		message: Schema.String,
		detail: Schema.optional(Schema.String),
	},
) {}

// Re-export session errors from domain package for convenience
export {
	ClerkUserFetchError,
	InvalidBearerTokenError,
	InvalidJwtPayloadError,
	SessionAuthenticationError,
	SessionExpiredError,
	SessionLoadError,
	SessionNotProvidedError,
	SessionRefreshError,
} from "@hazel/domain"
