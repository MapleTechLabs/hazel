import { Effect, Predicate, Schema } from "effect"
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
 * Keeps the underlying failure on an error for server-side logs and traces without making it
 * part of the error's schema: `cause` is the native, non-enumerable `Error.cause`, so it is never
 * encoded into RPC or HTTP responses.
 */
export const attachCause = (error: Error, cause: unknown) => {
	if (cause === undefined) return
	Object.defineProperty(error, "cause", {
		value: cause,
		enumerable: false,
		writable: true,
		configurable: true,
	})
}

/**
 * An unexpected server failure. Clients see only the stable `message` (and `detail`, which must
 * be client-safe: never `String(error)` or driver text). Pass the underlying failure as `cause`:
 * it stays on the server, where the error reporter logs it with the full `Cause`.
 */
export class InternalServerError extends Schema.TaggedError<InternalServerError>("InternalServerError")(
	"InternalServerError",
	{
		message: Schema.String,
		detail: Schema.optional(Schema.String),
	},
	{ httpApiStatus: 500 },
) {
	static is(u: unknown): u is InternalServerError {
		return Predicate.isTagged(u, "InternalServerError")
	}

	constructor(
		props: { readonly message: string; readonly detail?: string | undefined; readonly cause?: unknown },
		options?: Schema.MakeOptions,
	) {
		const { cause, ...fields } = props
		super(fields, options)
		attachCause(this, cause)
	}
}

/** The request does not fit the channel or is malformed (e.g. naming a channel that is not a thread). */
export class InvalidChannelRequestError extends Schema.TaggedError<InvalidChannelRequestError>(
	"InvalidChannelRequestError",
)(
	"InvalidChannelRequestError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 400 },
) {}

/**
 * The operation acts on the caller's active organization, and the session has none
 * (`CurrentUser.organizationId` is unset).
 */
export class ActiveOrganizationRequiredError extends Schema.TaggedError<ActiveOrganizationRequiredError>(
	"ActiveOrganizationRequiredError",
)(
	"ActiveOrganizationRequiredError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 400 },
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
 * A live-state write would grow the message's live state past what one reply may hold. Nothing was
 * applied; finish the reply (or replace its text) instead of appending more.
 */
export class LiveStateTooLargeError extends Schema.TaggedError<LiveStateTooLargeError>(
	"LiveStateTooLargeError",
)(
	"LiveStateTooLargeError",
	{
		messageId: MessageId,
		limitBytes: Schema.Number,
	},
	{ httpApiStatus: 413 },
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
 * Turns the repository layer's `DatabaseError` / `SchemaError` into a client-safe
 * `InternalServerError`, keeping the original failure as its server-side `cause`.
 */
export function withRemapDbErrors(
	entityType: string,
	action: "update" | "create" | "delete" | "select",
	entityId?: unknown | { value: unknown; key: string }[],
) {
	return <A, E, R>(
		effect: Effect.Effect<A, E, R>,
	): Effect.Effect<A, Exclude<E, { _tag: "DatabaseError" | "SchemaError" }> | InternalServerError, R> => {
		const toInternalError = (cause: unknown, detailPrefix: string) =>
			Effect.fail(
				new InternalServerError({
					message: `Error ${action}ing ${entityType}`,
					detail: constructDetailMessage(detailPrefix, entityType, entityId),
					cause,
				}),
			)

		return effect.pipe(
			Effect.catchIf(
				(e): e is Extract<E, { _tag: "DatabaseError" | "SchemaError" }> =>
					Predicate.isTagged(e, "DatabaseError") || Predicate.isTagged(e, "SchemaError"),
				(err) =>
					toInternalError(
						err,
						Predicate.isTagged(err, "DatabaseError")
							? "There was a database error when"
							: "There was an error in parsing when",
					),
			),
		) as Effect.Effect<A, Exclude<E, { _tag: "DatabaseError" | "SchemaError" }> | InternalServerError, R>
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

// Thread naming errors, for frontend error handling
export {
	AIProviderUnavailableError,
	AIRateLimitError,
	AIResponseParseError,
	OriginalMessageNotFoundError,
	ThreadChannelNotFoundError,
	ThreadContextQueryError,
	ThreadNameUpdateError,
	ThreadNamingWorkflowError,
} from "./thread-naming-errors"
