/**
 * The pulls: a full walk of the Stripe account (the connect-time backfill), or the events since the
 * last success (every scheduled pull and "sync now"). The phase and Stripe's paging cursor live in
 * the run's cursor, so an evicted object resumes where it stopped.
 *
 * | Phase | Request | Writes |
 * |---|---|---|
 * | `customers` | `/customers` | accounts (matched by shared id or domain) and their billing contacts |
 * | `subscriptions` | `/subscriptions?status=all` (expanded, `subscriptionExpands`) + `/products?ids[]=…` per page | subscriptions, MRR |
 * | `invoices` | `/invoices`, the last {@link INVOICE_BACKFILL_DAYS} days | invoices |
 * | `events` | `/events?types[]=…&created[gte]=since` + one read per changed object | whatever changed |
 *
 * Paging is Stripe's own `starting_after`, which is id-based: a record deleted mid-walk cannot
 * shift a page past another one, so no page has to re-read the one before it.
 *
 * **The full walk (`since: null`) lists everything**, so its last page sets `sweep: ["account"]` and
 * core removes the customers it did not see (deleted while no webhook reached Hazel). Contacts are
 * not swept: a Stripe contact row is usually the Clerk member's too, and removing Stripe's ref
 * would soft-delete the person. Invoices older than a year are not read, so a decade of them cannot
 * stall a connection.
 *
 * **A scheduled pull reads Stripe's event log.** None of Stripe's list endpoints filter by a change
 * time, only by `created`, so listing what was created since the last success misses every change
 * to an older subscription or invoice (a renewal, a cancellation, a failed payment). `/v1/events`
 * is the change feed: every event since `since` (core's overlap included) of the types the webhook
 * handles, each turned into ops exactly as a delivery is (`./webhook.ts`, `readEvent`: the
 * object's current state is read, so the order events are applied in does not matter). Objects are
 * read once per page however many of their events it holds, up to {@link EVENT_READ_CONCURRENCY}
 * at a time, and the page's plans are named in one `/products?ids[]=…` lookup (per 100 products),
 * so a pull costs about one request per changed object. Events are listed {@link EVENTS_PAGE_SIZE}
 * at a time: a page that fails (a 429 not waited out in place) is read again whole, so a small
 * page bounds what a rate-limited account re-reads. Core never gives up on a page for rate limits
 * (`rate_limited` is not "stuck"), so under constant throttling the pull advances at the pace
 * Stripe's `Retry-After` allows. An object that cannot be read for good (a 4xx other than 404, a
 * body that does not decode) is logged and skipped, as a delivery is acknowledged; a refused key
 * and a transient failure fail the page. It needs the key's **Events: Read**
 * permission (`validate` checks it). Stripe keeps events for 30 days, so a `since` older than that
 * (a connection idle for a month) runs the full walk instead. This is what keeps a connection
 * without a webhook endpoint correct, if up to a pull interval late (`./adapter.ts`).
 */
import type { ConnectionConfig, IngestOp, IsoTimestamp, SyncProgress } from "@hazel/domain/customers"
import { Clock, Effect, Option, Schema } from "effect"
import type { PullPage } from "../providers"
import type { StripeGet, StripeQuery } from "./http"
import { customerOps, invoiceOp } from "./map"
import { isTransient, NOTHING_READ, opsOfReads, readEvent, STRIPE_EVENT_TYPES } from "./webhook"
import {
	StripeCustomersPage,
	StripeEventsPage,
	StripeInvoicesPage,
	StripeSubscriptionsPage,
	subscriptionExpands,
} from "./wire"

/** Stripe's list endpoints cap `limit` at 100. */
export const PAGE_SIZE = 100
/** How far back a backfill reads invoices. Older ones answer no signal and no rollup. */
const INVOICE_BACKFILL_DAYS = 365
/** Stripe keeps events for 30 days; a day of margin for the clock and the run's own length. */
const EVENTS_RETENTION_MS = 29 * 86_400_000
/** Objects an events page reads at once: Stripe's test mode allows 25 requests a second. */
const EVENT_READ_CONCURRENCY = 4
/** Events per page: at most this many object reads are redone when a page fails. */
const EVENTS_PAGE_SIZE = 25

const StripePhase = Schema.Literals(["customers", "subscriptions", "invoices", "events"])
type StripePhase = typeof StripePhase.Type

/** Which phase the walk is in, and Stripe's paging cursor. */
const StripeCursor = Schema.Struct({
	phase: StripePhase,
	/** The last id of the page before, Stripe's `starting_after`. */
	after: Schema.NullOr(Schema.String),
	/** Records done in this phase, for the progress the data-sources page shows. */
	done: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
})
type StripeCursor = typeof StripeCursor.Type

const decodeDocument = Schema.decodeUnknownOption(Schema.fromJsonString(StripeCursor))

/** The run's cursor; `None` for one Hazel cannot read (a format change between deploys). */
export const decodeCursor = (cursor: string): Option.Option<StripeCursor> => decodeDocument(cursor)

export const encodeCursor = (cursor: StripeCursor): string => JSON.stringify(cursor)

const NEXT_PHASE = {
	customers: "subscriptions",
	subscriptions: "invoices",
	invoices: null,
	events: null,
} satisfies Readonly<Record<StripePhase, StripePhase | null>>

const doneOf = (cursor: StripeCursor): number => cursor.done ?? 0

/** One page's ops and where the walk goes after it: on in this phase, into the next one, or done. */
const pageOf = (
	cursor: StripeCursor,
	ops: ReadonlyArray<IngestOp>,
	rows: ReadonlyArray<{ readonly id?: string | null }>,
	hasMore: boolean | null | undefined,
): PullPage => {
	const done = doneOf(cursor) + rows.length
	const lastId = rows[rows.length - 1]?.id ?? null
	const next = NEXT_PHASE[cursor.phase]
	const nextCursor =
		hasMore === true && lastId !== null
			? encodeCursor({ phase: cursor.phase, after: lastId, done })
			: next === null
				? null
				: encodeCursor({ phase: next, after: null, done: 0 })
	// Stripe's lists carry no total; only `has_more`.
	const progress: SyncProgress = { step: cursor.phase, done, total: null }
	// Only the full walk's last page: it listed every customer of the account.
	return nextCursor === null && cursor.phase !== "events"
		? { ops, nextCursor, progress, sweep: ["account"] }
		: { ops, nextCursor, progress }
}

/** Unix seconds, which is what Stripe's `created` filters take. */
const secondsOf = (ms: number): string => String(Math.floor(ms / 1000))

const query = (cursor: StripeCursor, extra: StripeQuery = [], limit = PAGE_SIZE): StripeQuery => [
	["limit", String(limit)],
	...(cursor.after === null ? [] : [["starting_after", cursor.after] as const]),
	...extra,
]

const customersPage = Effect.fnUntraced(function* (
	get: StripeGet,
	cursor: StripeCursor,
	config: ConnectionConfig,
	at: IsoTimestamp,
) {
	const body = yield* get("/customers", query(cursor), StripeCustomersPage)
	const ops = body.data.flatMap((customer) => customerOps(customer, config, at))
	return pageOf(cursor, ops, body.data, body.has_more)
})

const subscriptionsPage = Effect.fnUntraced(function* (
	get: StripeGet,
	cursor: StripeCursor,
	at: IsoTimestamp,
) {
	const body = yield* get(
		"/subscriptions",
		// Canceled ones too: an account churns by its subscription's amount.
		query(cursor, [["status", "all"], ...subscriptionExpands("data.")]),
		StripeSubscriptionsPage,
	)
	const ops = yield* opsOfReads(get, [{ ops: [], subscriptions: body.data }], at)
	return pageOf(cursor, ops, body.data, body.has_more)
})

const invoicesPage = Effect.fnUntraced(function* (
	get: StripeGet,
	cursor: StripeCursor,
	nowMs: number,
	at: IsoTimestamp,
) {
	const body = yield* get(
		"/invoices",
		query(cursor, [["created[gte]", secondsOf(nowMs - INVOICE_BACKFILL_DAYS * 86_400_000)]]),
		StripeInvoicesPage,
	)
	const ops = body.data.flatMap((invoice) => {
		const op = invoiceOp(invoice, { observedAt: at })
		return op === null ? [] : [op]
	})
	return pageOf(cursor, ops, body.data, body.has_more)
})

const ObjectId = Schema.Struct({ id: Schema.String })
const objectIdOf = Schema.decodeUnknownOption(ObjectId)

const eventsPage = Effect.fnUntraced(function* (
	get: StripeGet,
	cursor: StripeCursor,
	since: Date | null,
	config: ConnectionConfig,
	at: IsoTimestamp,
) {
	const body = yield* get(
		"/events",
		query(
			cursor,
			[
				...(since === null ? [] : [["created[gte]", secondsOf(since.getTime())] as const]),
				...STRIPE_EVENT_TYPES.map((type) => ["types[]", type] as const),
			],
			EVENTS_PAGE_SIZE,
		),
		StripeEventsPage,
	)
	// One read per object: which of its events comes first does not matter, the read is current.
	const seen = new Set<string>()
	const distinct = body.data.filter((event) => {
		const id = Option.getOrUndefined(objectIdOf(event.data.object))?.id
		if (id === undefined || seen.has(id)) return false
		seen.add(id)
		return true
	})
	// Oldest first (Stripe lists newest first), so a new customer lands before its subscription.
	const reads = yield* Effect.forEach(
		distinct.reverse(),
		(event) =>
			readEvent(get, event, config, at).pipe(
				// A payload with no usable id: logged, and the rest of the page goes on.
				Effect.catchTag("CustomerWebhookRejectedError", () => Effect.succeed(NOTHING_READ)),
				// One object Stripe will never answer for (a 4xx, a body that does not decode): skipped,
				// as a delivery of it is acknowledged. A refused key or a transient failure fails the page.
				Effect.catchTag("CustomerProviderError", (error) =>
					error.code === "auth" || isTransient(error)
						? Effect.fail(error)
						: Effect.logWarning("Stripe event skipped: its object cannot be read", {
								type: event.type,
								code: error.code,
								status: error.httpStatus,
								message: error.message,
							}).pipe(Effect.as(NOTHING_READ)),
				),
			),
		{ concurrency: EVENT_READ_CONCURRENCY },
	)
	yield* Effect.annotateCurrentSpan("stripe.objects_read", distinct.length)
	return pageOf(cursor, yield* opsOfReads(get, reads, at), body.data, body.has_more)
})

export const pullPage = Effect.fn("Stripe.pullPage")(function* (input: {
	readonly get: StripeGet
	readonly cursor: string | null
	readonly since: Date | null
	readonly config: ConnectionConfig
}) {
	const nowMs = yield* Clock.currentTimeMillis
	// Taken before any request: the ops' `observedAt` (a listing proves its records live as of it,
	// and ingest drops a subscription or invoice read older than one it applied).
	const at = new Date(nowMs).toISOString()
	const { get, since, config } = input
	const events = since !== null && nowMs - since.getTime() < EVENTS_RETENTION_MS
	const start: StripeCursor = { phase: events ? "events" : "customers", after: null }
	const decoded = input.cursor === null ? Option.some(start) : decodeCursor(input.cursor)
	if (Option.isNone(decoded)) {
		yield* Effect.logWarning("Stripe pull cursor unreadable: the pull starts over", {
			phase: start.phase,
		})
	}
	const cursor = Option.getOrElse(decoded, () => start)
	const page: PullPage =
		cursor.phase === "customers"
			? yield* customersPage(get, cursor, config, at)
			: cursor.phase === "subscriptions"
				? yield* subscriptionsPage(get, cursor, at)
				: cursor.phase === "invoices"
					? yield* invoicesPage(get, cursor, nowMs, at)
					: yield* eventsPage(get, cursor, since, config, at)
	yield* Effect.annotateCurrentSpan({
		"stripe.phase": cursor.phase,
		"stripe.received": page.progress.done - doneOf(cursor),
		"stripe.ops": page.ops.length,
		"stripe.resumed": cursor.after !== null,
		"stripe.sweep_complete": page.sweep !== undefined,
	})
	return page
})
