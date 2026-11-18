/**
 * The pull: `users.messages.list` over a search fixed when the walk starts, one page of ids at a
 * time, then `users.messages.get` (`format=full`) for each id on the page.
 *
 * **Window.** `after:<epoch seconds>`: a backfill (`since: null`) reads `lookbackDays` back, a
 * scheduled pull from `since` (core's last success minus its overlap; ingest is idempotent, so a
 * message read twice lands once). Spam, trash and chats are left out. The `after` of a walk is kept
 * on the cursor beside Gmail's `pageToken`, which is only valid for the search that issued it.
 *
 * **Page size.** A page costs one list and {@link PAGE_SIZE} gets (plus a token refresh the first
 * time a tick pulls the connection), read {@link CONCURRENCY} at a time. Core pulls up to 20 pages
 * of a connection per alarm, so a tick stays around 500 subrequests per mailbox, and Gmail's
 * per-user quota (250 units a second; a get costs 5) is never approached.
 *
 * **Errors.** A message deleted between the list and its get (404) is skipped; any other failure is
 * the page's, and core resumes the run at the same cursor after its backoff.
 *
 * **No sweeps.** A message the mailbox no longer holds is still an email that happened.
 */
import type { ConnectionConfig, IngestOp, SyncProgress } from "@hazel/domain/customers"
import { Clock, Effect, Option, Schema } from "effect"
import type { PullPage } from "../providers"
import type { GmailApi } from "./http"
import { emailOp } from "./map"

/** Polling (no Pub/Sub push): ten minutes is soon enough for a timeline. */
export const GMAIL_PULL_INTERVAL_MS = 10 * 60_000

export const PAGE_SIZE = 25
const CONCURRENCY = 5

const GmailCursor = Schema.Struct({
	/** The walk's window start, epoch seconds: the search every page token of the walk belongs to. */
	after: Schema.Int,
	pageToken: Schema.String,
	/** Messages read since the walk started, for the data sources page. */
	done: Schema.Int,
})
type GmailCursor = typeof GmailCursor.Type

const decodeCursor = Schema.decodeUnknownOption(Schema.fromJsonString(GmailCursor))

/** The search: the window, without spam, trash and Google Chat messages. */
export const queryOf = (after: number) => `after:${after} -in:spam -in:trash -in:chats`

export const pullPage = Effect.fn("Gmail.pullPage")(function* (input: {
	readonly api: GmailApi
	readonly mailbox: string
	readonly config: Extract<ConnectionConfig, { _tag: "gmail" }>
	readonly cursor: string | null
	readonly since: Date | null
}) {
	const nowMs = yield* Clock.currentTimeMillis
	const resumed = input.cursor === null ? Option.none<GmailCursor>() : decodeCursor(input.cursor)
	if (input.cursor !== null && Option.isNone(resumed)) {
		yield* Effect.logWarning("Gmail pull cursor unreadable: the pull starts over")
	}
	const startMs = input.since?.getTime() ?? nowMs - input.config.lookbackDays * 86_400_000
	const after = Option.match(resumed, {
		onNone: () => Math.floor(startMs / 1000),
		onSome: (cursor) => cursor.after,
	})
	const list = yield* input.api.list({
		q: queryOf(after),
		pageToken: Option.match(resumed, { onNone: () => null, onSome: (cursor) => cursor.pageToken }),
		maxResults: PAGE_SIZE,
	})
	const ids = (list.messages ?? []).map((message) => message.id)
	const messages = yield* Effect.forEach(
		ids,
		(id) =>
			input.api.message(id).pipe(
				Effect.map(Option.some),
				// Deleted since the list: nothing to read.
				Effect.catchIf(
					(error) => error.httpStatus === 404,
					() => Effect.succeedNone,
				),
			),
		{ concurrency: CONCURRENCY },
	)
	const ops: Array<IngestOp> = []
	for (const message of messages) {
		if (Option.isNone(message)) continue
		const op = emailOp(message.value, input.mailbox)
		if (op !== null) ops.push(op)
	}
	const done = Option.match(resumed, { onNone: () => 0, onSome: (cursor) => cursor.done }) + ids.length
	yield* Effect.annotateCurrentSpan({ "gmail.listed": ids.length, "gmail.ops": ops.length })
	const progress: SyncProgress = { step: "messages", done, total: null }
	return {
		ops,
		nextCursor:
			list.nextPageToken === undefined
				? null
				: JSON.stringify({ after, pageToken: list.nextPageToken, done } satisfies GmailCursor),
		progress,
	} satisfies PullPage
})
