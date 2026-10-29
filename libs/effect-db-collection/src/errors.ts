import { Schema } from "effect"

/**
 * Base error for collection operations
 */
export class DbCollectionError extends Schema.TaggedError<DbCollectionError>()("DbCollectionError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error thrown when an insert operation fails
 */
export class InsertError extends Schema.TaggedError<InsertError>()("InsertError", {
	message: Schema.String,
	data: Schema.optional(Schema.Unknown),
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error thrown when an update operation fails
 */
export class UpdateError extends Schema.TaggedError<UpdateError>()("UpdateError", {
	message: Schema.String,
	key: Schema.optional(Schema.Unknown),
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error thrown when a delete operation fails
 */
export class DeleteError extends Schema.TaggedError<DeleteError>()("DeleteError", {
	message: Schema.String,
	key: Schema.optional(Schema.Unknown),
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * The source's stream did not pass the write's `seq` in time. `txid` is the write position
 * (`<kind>:<id>:<seq>`).
 */
export class TxIdTimeoutError extends Schema.TaggedError<TxIdTimeoutError>()("TxIdTimeoutError", {
	message: Schema.String,
	txid: Schema.String,
	timeout: Schema.Number,
}) {}

/**
 * Error thrown when a required transaction ID is missing from handler result
 */
export class MissingTxIdError extends Schema.TaggedError<MissingTxIdError>()("MissingTxIdError", {
	message: Schema.String,
	operation: Schema.Literals(["insert", "update", "delete"]),
}) {}

/**
 * The transaction id is not a write position (`<kind>:<id>:<seq>`).
 */
export class InvalidTxIdError extends Schema.TaggedError<InvalidTxIdError>()("InvalidTxIdError", {
	message: Schema.String,
	receivedType: Schema.String,
}) {}

/**
 * Waiting for a write position failed for a reason other than a timeout (the source was
 * refused, does not exist, or its connection was closed). `cause` carries the source error.
 */
export class AwaitTxIdError extends Schema.TaggedError<AwaitTxIdError>()("AwaitTxIdError", {
	message: Schema.String,
	txid: Schema.String,
	collectionId: Schema.optional(Schema.String),
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error thrown when sync configuration is invalid
 */
export class SyncConfigError extends Schema.TaggedError<SyncConfigError>()("SyncConfigError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error thrown when an optimistic action fails
 */
export class OptimisticActionError extends Schema.TaggedError<OptimisticActionError>()(
	"OptimisticActionError",
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {}

/**
 * Error thrown when collection sync fails during optimistic action
 */
export class SyncError extends Schema.TaggedError<SyncError>()("SyncError", {
	message: Schema.String,
	txid: Schema.optional(Schema.String),
	collectionName: Schema.optional(Schema.String),
	timeout: Schema.optional(Schema.Number),
	cause: Schema.optional(Schema.Unknown),
}) {}

// ---------------------------------------------------------------------------
// Source connection errors
// ---------------------------------------------------------------------------

/** The source refused the principal (close code 4003). Not retried. */
export class SyncSourceForbiddenError extends Schema.TaggedError<SyncSourceForbiddenError>()(
	"SyncSourceForbiddenError",
	{
		message: Schema.String,
		source: Schema.String,
	},
) {}

/** The source does not exist, e.g. a deleted org or channel (close code 4004). Not retried. */
export class SyncSourceNotFoundError extends Schema.TaggedError<SyncSourceNotFoundError>()(
	"SyncSourceNotFoundError",
	{
		message: Schema.String,
		source: Schema.String,
	},
) {}

/**
 * The socket could not be (re)opened or died. The connection keeps retrying with backoff.
 * - `Network`: the socket closed or never opened
 * - `TokenUnavailable`: the API did not answer the token exchange
 * - `NoSession`: there is no session to take a token from
 * - `Reauth`: the source closed with 4001 again right after a reconnect with a fresh token
 * - `Heartbeat`: no frame arrived for a whole heartbeat interval after a `Ping`
 * - `Server`: the source sent an `Error` frame
 */
export class SyncConnectionError extends Schema.TaggedError<SyncConnectionError>()("SyncConnectionError", {
	message: Schema.String,
	source: Schema.String,
	reason: Schema.Literals(["Network", "TokenUnavailable", "NoSession", "Reauth", "Heartbeat", "Server"]),
	closeCode: Schema.optional(Schema.Number),
	cause: Schema.optional(Schema.Unknown),
}) {}

/** The connection was released before the awaited state was reached. */
export class SyncConnectionClosedError extends Schema.TaggedError<SyncConnectionClosedError>()(
	"SyncConnectionClosedError",
	{
		message: Schema.String,
		source: Schema.String,
	},
) {}

/** A source failure that stops a connection for good. */
export type SyncSourceTerminalError = SyncSourceForbiddenError | SyncSourceNotFoundError
