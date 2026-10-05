import { Effect, Predicate, Schema, SchemaIssue } from "effect"
import { ChannelId, MessageId } from "@hazel/schema"

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>("UnauthorizedError")(
	"UnauthorizedError",
	{
		message: Schema.String,
		detail: Schema.String,
	},
	{ httpApiStatus: 401 },
) {
	static is(u: unknown): u is UnauthorizedError {
		return Predicate.isTagged(u, "UnauthorizedError")
	}
}

/**
 * Error thrown when an OAuth authorization code has expired or has already been used.
 * This is a specific 401 error that indicates the user must restart the OAuth flow.
 */
export class OAuthCodeExpiredError extends Schema.TaggedError<OAuthCodeExpiredError>("OAuthCodeExpiredError")(
	"OAuthCodeExpiredError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 401 },
) {
	static is(u: unknown): u is OAuthCodeExpiredError {
		return Predicate.isTagged(u, "OAuthCodeExpiredError")
	}
}

export class OAuthStateMismatchError extends Schema.TaggedError<OAuthStateMismatchError>()(
	"OAuthStateMismatchError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 400 },
) {
	static is(u: unknown): u is OAuthStateMismatchError {
		return Predicate.isTagged(u, "OAuthStateMismatchError")
	}
}

export class OAuthRedemptionPendingError extends Schema.TaggedError<OAuthRedemptionPendingError>()(
	"OAuthRedemptionPendingError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 503 },
) {
	static is(u: unknown): u is OAuthRedemptionPendingError {
		return Predicate.isTagged(u, "OAuthRedemptionPendingError")
	}
}

export class InternalServerError extends Schema.TaggedError<InternalServerError>("InternalServerError")(
	"InternalServerError",
	{
		message: Schema.String,
		detail: Schema.optional(Schema.String),
		cause: Schema.optional(Schema.Any),
	},
	{ httpApiStatus: 500 },
) {}

export class WorkflowInitializationError extends Schema.TaggedError<WorkflowInitializationError>(
	"WorkflowInitializationError",
)(
	"WorkflowInitializationError",
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Any),
	},
	{ httpApiStatus: 500 },
) {}

export class DmChannelAlreadyExistsError extends Schema.TaggedError<DmChannelAlreadyExistsError>(
	"DmChannelAlreadyExistsError",
)(
	"DmChannelAlreadyExistsError",
	{
		message: Schema.String,
		detail: Schema.optional(Schema.String),
	},
	{ httpApiStatus: 409 },
) {}

/**
 * Error thrown when a message is not found.
 * Used in update, delete, and thread creation operations.
 */
export class MessageNotFoundError extends Schema.TaggedError<MessageNotFoundError>("MessageNotFoundError")(
	"MessageNotFoundError",
	{
		messageId: MessageId,
	},
	{ httpApiStatus: 404 },
) {}

/**
 * Error thrown when attempting to create a thread within a thread.
 * Nested threads are not supported.
 */
export class NestedThreadError extends Schema.TaggedError<NestedThreadError>("NestedThreadError")(
	"NestedThreadError",
	{
		channelId: ChannelId,
	},
	{ httpApiStatus: 400 },
) {}

/**
 * Error thrown when the workflow service is unreachable or unavailable.
 * Used when the cluster service cannot be contacted.
 */
export class WorkflowServiceUnavailableError extends Schema.TaggedError<WorkflowServiceUnavailableError>(
	"WorkflowServiceUnavailableError",
)(
	"WorkflowServiceUnavailableError",
	{
		message: Schema.String,
		cause: Schema.optional(Schema.NullOr(Schema.String)),
	},
	{ httpApiStatus: 503 },
) {}

export function withRemapDbErrors<R, E extends { _tag: string }, A>(
	entityType: string,
	action: "update" | "create" | "delete" | "select",
	entityId?: unknown | { value: unknown; key: string }[],
) {
	return (
		effect: Effect.Effect<R, E, A>,
	): Effect.Effect<R, Exclude<E, { _tag: "DatabaseError" | "SchemaError" }> | InternalServerError, A> => {
		const toInternalError = (err: unknown, detailPrefix: string) =>
			Effect.fail(
				new InternalServerError({
					message: `Error ${action}ing ${entityType}`,
					detail: constructDetailMessage(detailPrefix, entityType, entityId),
					cause: String(err),
				}),
			)

		return effect.pipe(
			Effect.catchIf(
				(e): e is Extract<E, { _tag: "DatabaseError" }> => Predicate.isTagged(e, "DatabaseError"),
				(err) => toInternalError(err, "There was a database error when"),
			),
			Effect.catchIf(
				(e): e is Extract<E, { _tag: "SchemaError" }> => Predicate.isTagged(e, "SchemaError"),
				(err) => toInternalError(err, "There was an error in parsing when"),
			),
		) as Effect.Effect<R, Exclude<E, { _tag: "DatabaseError" | "SchemaError" }> | InternalServerError, A>
	}
}

const constructDetailMessage = (
	title: string,
	entityType: string,
	entityId?: unknown | { value: unknown; key: string }[],
) => {
	if (entityId) {
		if (Array.isArray(entityId)) {
			return `${title} the ${entityType} with values ${entityId
				.map((value) => `${value.key}: ${value.value}`)
				.join(", ")}`
		}
		return `${title} the ${entityType} with id ${entityId}`
	}

	return `${title} the ${entityType}`
}

// Re-export permission error for scope-based authorization
export { PermissionError } from "./scopes/permission-error"

// Re-export session errors for frontend convenience
export * from "./session-errors"

// Re-export desktop auth errors for frontend convenience
export * from "./desktop-auth-errors"

// Re-export thread naming workflow errors for frontend error handling
// These are plain Schema.TaggedError classes that don't depend on @effect/cluster
export {
	AIProviderUnavailableError,
	AIRateLimitError,
	AIResponseParseError,
	OriginalMessageNotFoundError,
	ThreadChannelNotFoundError,
	ThreadContextQueryError,
	ThreadNameUpdateError,
	ThreadNamingWorkflowError,
} from "./cluster/activities/thread-naming-activities"
