import { Schema } from "effect"

/**
 * The source's stream did not pass the write's `seq` in time. `txid` is the write position
 * (`<kind>:<id>:<seq>`).
 */
export class TxIdTimeoutError extends Schema.TaggedError<
	TxIdTimeoutError,
	{ readonly brand: unique symbol }
>()("TxIdTimeoutError", {
	message: Schema.String,
	txid: Schema.String,
	timeout: Schema.Finite,
}) {}

/**
 * The transaction id is not a write position (`<kind>:<id>:<seq>`).
 */
export class InvalidTxIdError extends Schema.TaggedError<
	InvalidTxIdError,
	{ readonly brand: unique symbol }
>()("InvalidTxIdError", {
	message: Schema.String,
	receivedType: Schema.String,
}) {}

/**
 * Waiting for a write position failed for a reason other than a timeout (the source was
 * refused, does not exist, or its connection was closed). `cause` carries the source error.
 */
export class AwaitTxIdError extends Schema.TaggedError<AwaitTxIdError, { readonly brand: unique symbol }>()(
	"AwaitTxIdError",
	{
		message: Schema.String,
		txid: Schema.String,
		collectionId: Schema.optional(Schema.String),
		cause: Schema.optional(Schema.Unknown),
	},
) {}

/**
 * Error thrown when an optimistic action fails
 */
export class OptimisticActionError extends Schema.TaggedError<
	OptimisticActionError,
	{ readonly brand: unique symbol }
>()("OptimisticActionError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error thrown when collection sync fails during optimistic action
 */
export class SyncError extends Schema.TaggedError<SyncError, { readonly brand: unique symbol }>()(
	"SyncError",
	{
		message: Schema.String,
		txid: Schema.optional(Schema.String),
		collectionName: Schema.optional(Schema.String),
		timeout: Schema.optional(Schema.Finite),
		cause: Schema.optional(Schema.Unknown),
	},
) {}

// ---------------------------------------------------------------------------
// Source connection errors
// ---------------------------------------------------------------------------

/** The source refused the principal (close code 4003). Not retried. */
export class SyncSourceForbiddenError extends Schema.TaggedError<
	SyncSourceForbiddenError,
	{ readonly brand: unique symbol }
>()("SyncSourceForbiddenError", {
	message: Schema.String,
	source: Schema.String,
}) {}

/** The source does not exist, e.g. a deleted org or channel (close code 4004). Not retried. */
export class SyncSourceNotFoundError extends Schema.TaggedError<
	SyncSourceNotFoundError,
	{ readonly brand: unique symbol }
>()("SyncSourceNotFoundError", {
	message: Schema.String,
	source: Schema.String,
}) {}

/**
 * The socket could not be (re)opened or died. The connection keeps retrying with backoff.
 * - `Network`: the socket closed or never opened
 * - `TokenUnavailable`: the API did not answer the token exchange
 * - `NoSession`: there is no session to take a token from
 * - `Reauth`: the source closed with 4001 again right after a reconnect with a fresh token
 * - `Heartbeat`: no frame arrived for a whole heartbeat interval after a `Ping`
 * - `Server`: the source sent an `Error` frame
 */
export class SyncConnectionError extends Schema.TaggedError<
	SyncConnectionError,
	{ readonly brand: unique symbol }
>()("SyncConnectionError", {
	message: Schema.String,
	source: Schema.String,
	reason: Schema.Literals(["Network", "TokenUnavailable", "NoSession", "Reauth", "Heartbeat", "Server"]),
	closeCode: Schema.optional(Schema.Finite),
	cause: Schema.optional(Schema.Unknown),
}) {}

/** The connection was released before the awaited state was reached. */
export class SyncConnectionClosedError extends Schema.TaggedError<
	SyncConnectionClosedError,
	{ readonly brand: unique symbol }
>()("SyncConnectionClosedError", {
	message: Schema.String,
	source: Schema.String,
}) {}

/** A source failure that stops a connection for good. */
export type SyncSourceTerminalError = SyncSourceForbiddenError | SyncSourceNotFoundError
