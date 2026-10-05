/**
 * The `BotGateway` Durable Object's delivery rules, as pure functions over plain values so they
 * test without workerd. The object (`object-live.ts`) and the SQLite store (`event-store.ts`)
 * only wire these to storage and sockets.
 *
 * ## Offsets
 *
 * Every event appended to a bot's log gets the next sequence number (1, 2, 3, ...); numbers are
 * never reused, even after the rows are trimmed. On the wire an offset is the sequence number of
 * the last event a client has consumed, zero-padded to {@link OFFSET_WIDTH} digits so offsets
 * also compare as strings. Reading "from" an offset returns the events strictly after it, and a
 * batch's `nextOffset` is its last event's offset: the same exclusive-cursor semantics the
 * Durable Streams server had, so `libs/bot-sdk` saves and resumes offsets unchanged.
 *
 * Special client offsets, as the SDK documents them: `"-1"` replays everything still retained,
 * `"now"` tails only new events. An offset this log never issued (for example one saved from the
 * Durable Streams server before the cutover) replays everything retained, favouring at-least-once
 * delivery over silently skipping events. An offset ahead of the log's head (the object's storage
 * was reset) is clamped to the head.
 *
 * ## Acks and trimming
 *
 * At most one batch is in flight per session. The session's cursor advances only when the client
 * ACKs exactly the in-flight batch's `nextOffset` (any other ACK is ignored, as before), and an
 * accepted ACK trims every event at or before it: with one consumer per bot, an acknowledged
 * event is never needed again. Unacknowledged events are bounded by {@link DEFAULT_RETENTION}.
 */

/** Digits in a wire offset. */
export const OFFSET_WIDTH = 16

/** Sequence number of the last consumed event; `0` before the first event. */
export type Seq = number

export const formatOffset = (seq: Seq): string => String(seq).padStart(OFFSET_WIDTH, "0")

const OFFSET_PATTERN = /^\d{1,16}$/

/** A wire offset this log issued, or `undefined`. */
export const parseOffset = (raw: string): Seq | undefined => {
	if (!OFFSET_PATTERN.test(raw)) return undefined
	const seq = Number(raw)
	return Number.isSafeInteger(seq) ? seq : undefined
}

/** Where a client asked to resume from. */
export type ResumePoint =
	| { readonly _tag: "Earliest" }
	| { readonly _tag: "Latest" }
	| { readonly _tag: "After"; readonly seq: Seq }

export const parseResumeOffset = (raw: string): ResumePoint => {
	const trimmed = raw.trim()
	if (trimmed === "now") return { _tag: "Latest" }
	if (trimmed === "-1") return { _tag: "Earliest" }
	const seq = parseOffset(trimmed)
	return seq === undefined ? { _tag: "Earliest" } : { _tag: "After", seq }
}

/** The log's extent: `head` is the last sequence number ever assigned (`0` for a fresh log). */
export interface LogBounds {
	readonly head: Seq
	/** The oldest retained event, or `undefined` when every event has been trimmed. */
	readonly firstRetained: Seq | undefined
}

/** The session cursor (last consumed sequence number) a resume point starts from. */
export const resolveCursor = (point: ResumePoint, bounds: LogBounds): Seq => {
	switch (point._tag) {
		case "Latest":
			return bounds.head
		case "Earliest":
			return bounds.firstRetained === undefined ? bounds.head : bounds.firstRetained - 1
		case "After":
			return Math.min(Math.max(point.seq, 0), bounds.head)
	}
}

export interface StoredEvent {
	readonly seq: Seq
	/** The envelope as JSON text, exactly as published. */
	readonly body: string
}

export interface BatchLimits {
	readonly maxEvents: number
	readonly maxBytes: number
}

/** Batch caps: far below the 1 MiB WebSocket message limit, and a size bots process promptly. */
export const DEFAULT_BATCH_LIMITS: BatchLimits = { maxEvents: 100, maxBytes: 512 * 1024 }

/**
 * The prefix of `events` (in log order) that fits `limits`. Never empty when `events` is not, so
 * one oversized event still goes out on its own instead of wedging the session.
 */
export const selectBatch = (
	events: ReadonlyArray<StoredEvent>,
	limits: BatchLimits = DEFAULT_BATCH_LIMITS,
): ReadonlyArray<StoredEvent> => {
	const batch: Array<StoredEvent> = []
	let bytes = 0
	for (const event of events) {
		if (batch.length >= limits.maxEvents) break
		const size = event.body.length
		if (batch.length > 0 && bytes + size > limits.maxBytes) break
		batch.push(event)
		bytes += size
	}
	return batch
}

/**
 * The DISPATCH frame for a batch, built by splicing the stored JSON bodies (validated when they
 * were published) instead of parsing and re-serialising every event.
 */
export const encodeDispatchFrame = (sessionId: string, batch: ReadonlyArray<StoredEvent>): string => {
	const last = batch[batch.length - 1]
	if (last === undefined) throw new Error("encodeDispatchFrame: empty batch")
	return `{"op":"DISPATCH","sessionId":${JSON.stringify(sessionId)},"events":[${batch
		.map((event) => event.body)
		.join(",")}],"nextOffset":${JSON.stringify(formatOffset(last.seq))}}`
}

/** The delivery state a session carries (in its socket attachment, so it survives hibernation). */
export interface SessionCursor {
	readonly sessionId: string
	readonly cursor: Seq
	/** The in-flight batch's last sequence number, or `null` when nothing awaits an ACK. */
	readonly pending: Seq | null
	/** Epoch ms after which an unacknowledged batch ends the session. */
	readonly pendingDeadline: number | null
}

export type AckOutcome =
	| { readonly _tag: "Accepted"; readonly cursor: Seq }
	| {
			readonly _tag: "Ignored"
			readonly reason: "no_pending_batch" | "session_mismatch" | "offset_mismatch"
	  }

/** Today's ACK rule: only an ACK for exactly the in-flight batch, on its own session, counts. */
export const evaluateAck = (
	session: SessionCursor,
	ack: { readonly sessionId: string; readonly nextOffset: string },
): AckOutcome => {
	if (session.pending === null) return { _tag: "Ignored", reason: "no_pending_batch" }
	if (ack.sessionId !== session.sessionId) return { _tag: "Ignored", reason: "session_mismatch" }
	if (ack.nextOffset !== formatOffset(session.pending)) {
		return { _tag: "Ignored", reason: "offset_mismatch" }
	}
	return { _tag: "Accepted", cursor: session.pending }
}

/** The handshake the gateway Worker forwards once it has authenticated a bot. */
export type SessionRequest =
	| { readonly op: "IDENTIFY"; readonly resumeOffset: string }
	| { readonly op: "RESUME"; readonly sessionId: string; readonly resumeOffset: string }

export type Admission =
	| { readonly _tag: "Accept" }
	| { readonly _tag: "Replace"; readonly previousSessionId: string }
	| { readonly _tag: "Reject"; readonly reason: string }

/** The reason the Bun gateway gave when the Redis lease was held; bots log it verbatim. */
export const SESSION_CONFLICT_REASON = "another active session already owns this bot token"

/**
 * Second-connection policy, matching the Redis lease it replaces. The lease was keyed by session
 * id: the holder's own id renewed it, anyone else was refused until it expired. So:
 *
 * - no live session: accept;
 * - a RESUME of the live session's own id: replace the old socket (the bot reconnected and the
 *   old socket is a half-open leftover; the old lease would have accepted the same id too);
 * - anything else: reject with {@link SESSION_CONFLICT_REASON}.
 *
 * Rejecting rather than "newest wins" avoids two bot processes with the same token kicking each
 * other off in a loop. The lease TTL's role, freeing the bot after a client vanishes, is played
 * by the gateway Worker's heartbeat watchdog, which closes a silent client's upstream socket
 * after the lease TTL.
 */
export const decideAdmission = (
	live: { readonly sessionId: string } | undefined,
	request: SessionRequest,
): Admission => {
	if (live === undefined) return { _tag: "Accept" }
	if (request.op === "RESUME" && request.sessionId === live.sessionId) {
		return { _tag: "Replace", previousSessionId: live.sessionId }
	}
	return { _tag: "Reject", reason: SESSION_CONFLICT_REASON }
}

export interface RetentionPolicy {
	/** Unacknowledged events kept per bot; older ones are dropped on append. */
	readonly maxEvents: number
	/** Age after which an unacknowledged event is dropped. */
	readonly maxAgeMs: number
}

/**
 * Bounds what an offline bot can accumulate. Durable Streams kept everything forever; with one
 * consumer per log, events nobody acknowledges within a week (or past 10k) are dropped.
 */
export const DEFAULT_RETENTION: RetentionPolicy = { maxEvents: 10_000, maxAgeMs: 7 * 24 * 60 * 60 * 1000 }

/** Sequence numbers at or below this fall outside `maxEvents`; `0` keeps everything. */
export const retentionFloor = (head: Seq, policy: RetentionPolicy): Seq =>
	Math.max(0, head - policy.maxEvents)

/**
 * When the object must next wake: the earliest ACK deadline, or when the oldest retained event
 * expires. `undefined` when nothing is scheduled.
 */
export const nextAlarmAt = (
	pendingDeadlines: ReadonlyArray<number>,
	oldestAppendedAt: number | undefined,
	policy: RetentionPolicy,
): number | undefined => {
	const candidates = [
		...pendingDeadlines,
		...(oldestAppendedAt === undefined ? [] : [oldestAppendedAt + policy.maxAgeMs]),
	]
	return candidates.length === 0 ? undefined : Math.min(...candidates)
}
