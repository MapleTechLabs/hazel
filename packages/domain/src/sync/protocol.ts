/**
 * The Durable Object sync protocol (see `infra/durable-object-sync-plan.md` §3): JSON text frames on
 * one hibernatable WebSocket per source object. A source streams changes to the tables it owns or
 * projects; the client applies each `Begin … Rows … Commit` run as one TanStack DB sync transaction.
 */
import { Schema } from "effect"

/** The kinds of object a client syncs from. */
export const SyncSourceKind = Schema.Literals(["org", "channel", "user"])
export type SyncSourceKind = typeof SyncSourceKind.Type

/** A source's change sequence number: monotonic per object, never reused. */
export const SyncSeq = Schema.Int.pipe(Schema.brand("@Hazel/SyncSeq"))
export type SyncSeq = typeof SyncSeq.Type

/** The WebSocket subprotocol a client offers; the session token rides as the second protocol entry. */
export const SYNC_SUBPROTOCOL = "hazel.v1"

/** Close codes a source uses besides the standard ones. */
export const SyncCloseCode = {
	/** The token expired or was revoked: reconnect with a fresh one. */
	Reauth: 4001,
	/** The principal may not read this source (or no longer may). Do not retry. */
	Forbidden: 4003,
	/** The source does not exist (deleted org or channel). Do not retry. */
	NotFound: 4004,
} as const

// ---------------------------------------------------------------------------
// Client → object
// ---------------------------------------------------------------------------

/** First frame on a socket: resume after `since`, or `null` for a full snapshot. */
export const SyncHello = Schema.TaggedStruct("Hello", {
	since: Schema.NullOr(SyncSeq),
})

export const SyncPing = Schema.TaggedStruct("Ping", {})

/**
 * A fresh token for the same user, sent before the socket expires (`Ready.expiresInMs`). The
 * object verifies it and moves the socket's expiry (`Reauthed`), or closes the socket with 4001.
 */
export const SyncReauth = Schema.TaggedStruct("Reauth", {
	token: Schema.String,
})

/**
 * A position in a paged table's history: rows order by `(createdAt, id)` descending, so ties on
 * `createdAt` break on `id`. `createdAt` is the row's ISO timestamp.
 */
export const SyncPageCursor = Schema.Struct({
	createdAt: Schema.String,
	id: Schema.String,
})
export type SyncPageCursor = typeof SyncPageCursor.Type

/**
 * Asks for up to `limit` rows of a paged table older than `before`, plus their dependent rows. The
 * answer is a `Begin{reset:false, request}` run (see {@link SyncBegin}).
 */
export const SyncLoadOlder = Schema.TaggedStruct("LoadOlder", {
	requestId: Schema.Int,
	table: Schema.String,
	before: SyncPageCursor,
	limit: Schema.Int,
})
export type SyncLoadOlder = typeof SyncLoadOlder.Type

export const SyncClientFrame = Schema.Union([SyncHello, SyncPing, SyncReauth, SyncLoadOlder])
export type SyncClientFrame = typeof SyncClientFrame.Type

// ---------------------------------------------------------------------------
// Object → client
// ---------------------------------------------------------------------------

/**
 * How much of a paged table's history the client holds: everything from `oldest` (inclusive) to
 * the newest row. `hasMore: false` means nothing older exists; `oldest` is `null` when the table
 * is empty for this principal.
 */
export const SyncWindow = Schema.Struct({
	table: Schema.String,
	oldest: Schema.NullOr(SyncPageCursor),
	hasMore: Schema.Boolean,
})
export type SyncWindow = typeof SyncWindow.Type

/**
 * Opens a sync transaction. `reset: true` means the client's state for this source is stale (first
 * snapshot, retention passed `since`, or visibility changed): drop every row this source fed before
 * applying the rows that follow.
 *
 * Paged tables (a channel's `messages`): a snapshot sends only the newest rows and their dependents,
 * and `windows` says where each paged table's history starts. `request` marks the answer to a
 * `LoadOlder`; its `windows` entry is the lowered start. The page closes with a `Commit` at the
 * socket's current `seq`, so it never moves the stream. Paging state lives only on the client:
 * a catch-up (`Hello{since}`) keeps paged rows, a reset drops them (re-request what is still
 * needed), and deltas carry changes to any row by key, paged in or not.
 */
export const SyncBegin = Schema.TaggedStruct("Begin", {
	reset: Schema.Boolean,
	request: Schema.optionalKey(Schema.Int),
	windows: Schema.optionalKey(Schema.Array(SyncWindow)),
})

/**
 * Rows of one table inside a transaction. `upserts` are full rows in their JSON encoding (the
 * table's domain model decodes them); `deletes` are row keys. A key the client does not hold is
 * ignored.
 */
export const SyncRows = Schema.TaggedStruct("Rows", {
	table: Schema.String,
	upserts: Schema.Array(Schema.Unknown),
	deletes: Schema.Array(Schema.String),
})

/**
 * Closes a sync transaction. Every flush sends one to every socket, visible rows or not, so a
 * client waiting for a write's `seq` always sees the source pass it.
 */
export const SyncCommit = Schema.TaggedStruct("Commit", {
	seq: SyncSeq,
})

/**
 * Milliseconds until the object closes the socket with 4001 unless a `Reauth` moves it. Absent or
 * `null` when the credential does not expire (or the object predates `Reauth`).
 */
const ExpiresInMs = Schema.optionalKey(Schema.NullOr(Schema.Number))

/** Sent once, after the first `Commit` on a socket: the initial snapshot is complete. */
export const SyncReady = Schema.TaggedStruct("Ready", {
	expiresInMs: ExpiresInMs,
})

/** A `Reauth` was accepted: the socket's new expiry. */
export const SyncReauthed = Schema.TaggedStruct("Reauthed", {
	expiresInMs: Schema.NullOr(Schema.Number),
})

/** Ephemeral, unstored broadcasts (reserved; typing and presence currently sync as rows). */
export const SyncEphemeral = Schema.TaggedStruct("Ephemeral", {
	topic: Schema.String,
	payload: Schema.Unknown,
})

export const SyncPong = Schema.TaggedStruct("Pong", {})

export const SyncErrorCode = Schema.Literals(["bad_frame", "forbidden", "not_found", "internal"])

export const SyncError = Schema.TaggedStruct("Error", {
	code: SyncErrorCode,
	message: Schema.String,
})

export const SyncServerFrame = Schema.Union([
	SyncBegin,
	SyncRows,
	SyncCommit,
	SyncReady,
	SyncReauthed,
	SyncEphemeral,
	SyncPong,
	SyncError,
])
export type SyncServerFrame = typeof SyncServerFrame.Type

// ---------------------------------------------------------------------------
// Write confirmation
// ---------------------------------------------------------------------------

/**
 * Where a write landed: `<kind>:<id>:<seq>`. RPC results return it as `transactionId`; the client
 * waits until that source's stream passes `seq`.
 */
export interface SyncWritePosition {
	readonly kind: SyncSourceKind
	readonly id: string
	readonly seq: SyncSeq
}

const WRITE_POSITION = /^(org|channel|user):([^:]+):(\d+)$/

export const formatWritePosition = (position: SyncWritePosition): string =>
	`${position.kind}:${position.id}:${position.seq}`

export const parseWritePosition = (value: string): SyncWritePosition | undefined => {
	const match = WRITE_POSITION.exec(value)
	if (match === null) return undefined
	return {
		kind: match[1] as SyncSourceKind,
		id: match[2]!,
		seq: Number(match[3]) as SyncSeq,
	}
}
