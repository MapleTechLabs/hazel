/**
 * The pulls: one full walk of the Autumn organization's environment, page by page, in three phases
 * held in the run's cursor so an evicted object resumes where it stopped.
 *
 * | Phase | Request | Writes | Requests per page |
 * |---|---|---|---|
 * | `features` | `POST /v1/features.list` | a metric definition per metered feature | 1 |
 * | `customers` | `POST /v1/customers.list` (+ pricing) | accounts, seats, feature usage, live plans and MRR | 1 (+2) |
 * | `subscriptions` | `POST /v1/subscriptions.list` (+ pricing) | ended plans | 1 (+2) |
 *
 * Pricing is `plans.list` + `organization`, kept a few minutes per connection (`./read.ts`), so a
 * walk pays for it about once.
 *
 * **Live plans come with their customer**, as a delivery reads them (`./read.ts`): the listing
 * expands each to the customer's own version of the plan (custom prices), and the customer's
 * balances carry the prepaid units its plans bill for — neither of which `subscriptions.list`
 * reports. A pull and a delivery price a plan the same way, so neither undoes the other.
 *
 * **Ended plans are a phase of their own.** A customer lists only the plans it holds *now* —
 * `active`, `past_due` and `scheduled` (`RELEVANT_STATUSES` in Autumn's server) — so a plan that
 * ended is invisible there and its Hazel row would keep its MRR for ever. `POST
 * /v1/subscriptions.list` reports `expired` rows too, across every customer. It is asked for every
 * state, each customer's rows together, so an ended plan whose id a live one reuses is recognised on
 * the page and left alone; only the ended ones are written.
 *
 * **Paging is Autumn's own opaque cursor** (`start_cursor` → `next_cursor`), and the customer
 * listing asks for its oldest rows first (`sort_order: "asc"`), so a customer created mid-walk lands
 * at the end rather than shifting the rows not read yet. A keyset cursor cannot skip a row behind a
 * deletion either, which is why — unlike Clerk's offset paging — no page re-reads the one before it.
 * `subscriptions.list` may answer a page with fewer rows than asked for (even none) while
 * `has_more` is true, so that loop follows `has_more`, never the row count.
 *
 * **Every pull lists everything.** None of Autumn's list endpoints filters by a change time
 * (`customers.list` filters by creation time only), so `since` cannot narrow a walk: each one reads
 * the whole environment and ingest writes only what actually changed. Webhooks carry the live
 * signal; the walk is the reconciliation behind them, which is why its period is hours rather than
 * minutes. The walk's last page sets `sweep: ["account", "subscription"]`: core removes the
 * customers it did not see and cancels the plans it did not read (a customer deleted in Autumn,
 * which sends no webhook for it). Not when the walk could not see everything:
 *
 * - a full customer page with no `next_cursor` whose last customer has no id: Autumn drops the cursor
 *   then (`CusBatchService.getCursorPage`), ending the listing early;
 * - a customer listing as many plans as Autumn returns per customer
 *   ({@link PLANS_LISTED_PER_CUSTOMER}): any beyond were cut, so plans are not swept;
 * - `has_more` with no cursor on a subscriptions page.
 *
 * Contacts are never swept: Autumn holds none of its own.
 */
import type { ConnectionConfig, IngestOp, IsoTimestamp, SyncProgress } from "@hazel/domain/customers"
import { SweepEntityType } from "@hazel/domain/customers"
import { Clock, Effect, Option, Schema } from "effect"
import type { CustomerProviderError } from "../provider-errors"
import type { PullPage } from "../providers"
import type { AutumnApi } from "./http"
import {
	balanceOps,
	accountOp,
	featureDefinitionOps,
	featureNamesOf,
	type Pricing,
	subscriptionOps,
} from "./map"
import { CUSTOMER_EXPAND, SUBSCRIPTIONS_PAGE_SIZE } from "./read"
import { type AutumnEnv, AutumnCustomersPage, AutumnFeaturesPage, AutumnSubscriptionsPage } from "./wire"

/** Customers per page. Autumn's ceiling is 5000; a hundred keeps a page's work (and its retry) small. */
export const PAGE_SIZE = 100

const AutumnPhase = Schema.Literals(["features", "customers", "subscriptions"])
type AutumnPhase = typeof AutumnPhase.Type

/**
 * Autumn's per-customer cap on the plans (subscriptions and purchases) a customer listing returns
 * (`DEFAULT_CUS_PRODUCT_LIMIT`); a customer at it may hold more.
 */
export const PLANS_LISTED_PER_CUSTOMER = 15

/** Every plan state a subscription row can be in. */
const ALL_SUBSCRIPTION_STATUSES = ["active", "past_due", "scheduled", "expired"]

/** Which phase the walk is in, and Autumn's opaque paging cursor; carried on the run as JSON. */
const AutumnCursor = Schema.Struct({
	phase: AutumnPhase,
	/** `next_cursor` from the page before; `null` for the phase's first page. */
	after: Schema.NullOr(Schema.String),
	/** Records done in this phase, for the progress the data-sources page shows. */
	done: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
	/** What the walk so far could not list completely, so its last page must not sweep. */
	unswept: Schema.optionalKey(Schema.Array(SweepEntityType)),
})
type AutumnCursor = typeof AutumnCursor.Type

const START: AutumnCursor = { phase: "features", after: null }

const decodeDocument = Schema.decodeUnknownOption(Schema.fromJsonString(AutumnCursor))

/** The run's cursor; `None` for one Hazel cannot read (a format change between deploys). */
export const decodeCursor = (cursor: string): Option.Option<AutumnCursor> => decodeDocument(cursor)

export const encodeCursor = (cursor: AutumnCursor): string => JSON.stringify(cursor)

const NEXT_PHASE = {
	features: "customers",
	customers: "subscriptions",
	subscriptions: null,
} satisfies Readonly<Record<AutumnPhase, AutumnPhase | null>>

const doneOf = (cursor: AutumnCursor): number => cursor.done ?? 0

const SWEPT: ReadonlyArray<SweepEntityType> = ["account", "subscription"]

/**
 * One page's ops and where the walk goes after it: on in this phase, into the next one, or done.
 * The last page of the whole walk sweeps what the walk listed completely.
 */
const pageOf = (
	cursor: AutumnCursor,
	page: {
		readonly ops: ReadonlyArray<IngestOp>
		readonly rows: number
		readonly next: string | null
		readonly unswept?: ReadonlyArray<SweepEntityType>
	},
): PullPage => {
	const done = doneOf(cursor) + page.rows
	const unswept = [...new Set([...(cursor.unswept ?? []), ...(page.unswept ?? [])])]
	const carried = unswept.length === 0 ? {} : { unswept }
	const after = NEXT_PHASE[cursor.phase]
	const nextCursor =
		page.next !== null
			? encodeCursor({ phase: cursor.phase, after: page.next, done, ...carried })
			: after === null
				? null
				: encodeCursor({ phase: after, after: null, done: 0, ...carried })
	// Autumn's lists carry no total; only `next_cursor` / `has_more`.
	const progress: SyncProgress = { step: cursor.phase, done, total: null }
	const sweep = SWEPT.filter((type) => !unswept.includes(type))
	return nextCursor === null && sweep.length > 0
		? { ops: page.ops, nextCursor, progress, sweep }
		: { ops: page.ops, nextCursor, progress }
}

/** A listing Autumn ended before it had listed everything: logged, and the walk will not sweep it. */
const listingCut = (phase: AutumnPhase, reason: string, unswept: ReadonlyArray<SweepEntityType>) =>
	Effect.logWarning("Autumn listing incomplete: the walk will not sweep", { phase, reason, unswept }).pipe(
		Effect.as(unswept),
	)

/** Every metered feature becomes a metric definition, so a chart is named after the feature. */
const featuresPage = Effect.fnUntraced(function* (api: AutumnApi, cursor: AutumnCursor) {
	const body = yield* api.post("/v1/features.list", {}, AutumnFeaturesPage)
	return pageOf(cursor, { ops: featureDefinitionOps(body.list), rows: body.list.length, next: null })
})

interface PageInput {
	readonly api: AutumnApi
	readonly pricing: Effect.Effect<Pricing, CustomerProviderError>
	readonly config: ConnectionConfig
	readonly env: AutumnEnv
	readonly at: Date
	readonly observedAt: IsoTimestamp
}

const customersPage = Effect.fnUntraced(function* (input: PageInput, cursor: AutumnCursor) {
	const body = yield* input.api.post(
		"/v1/customers.list",
		{
			start_cursor: cursor.after ?? "",
			limit: PAGE_SIZE,
			// Oldest first, so a customer created mid-walk lands past the cursor instead of before it.
			sort_order: "asc",
			expand: CUSTOMER_EXPAND,
		},
		AutumnCustomersPage,
	)
	// A key opens one organization and one environment; anything else is not this connection's.
	const customers = body.list.flatMap((customer) => {
		const id = customer.id ?? null
		return id === null || id.trim() === "" || (customer.env != null && customer.env !== input.env)
			? []
			: [{ ...customer, id }]
	})
	// Priced only when a plan is there to price.
	const pricing = customers.some((customer) => (customer.subscriptions ?? []).length > 0)
		? yield* input.pricing
		: null
	const ops = customers.flatMap((customer): Array<IngestOp> => {
		const balances = Object.values(customer.balances ?? {})
		const names = featureNamesOf(
			balances.map((balance) => ({ id: balance.feature_id, name: balance.feature?.name ?? null })),
		)
		return [
			accountOp(customer, input.config, input.env, input.observedAt),
			...balanceOps(customer, { names, at: input.at }),
			...(pricing === null
				? []
				: subscriptionOps(customer.subscriptions ?? [], {
						customerId: customer.id,
						pricing,
						balances,
						observedAt: input.observedAt,
					})),
		]
	})
	const next = body.next_cursor ?? null
	const capped = body.list.some(
		(customer) =>
			(customer.subscriptions ?? []).length + (customer.purchases ?? []).length >=
			PLANS_LISTED_PER_CUSTOMER,
	)
	// Autumn drops the cursor when a full page ends on a customer with no id of its own (a full page
	// without a cursor and a last customer with an id is simply the end).
	const last = body.list.at(-1)
	const cut = next === null && body.list.length >= PAGE_SIZE && (last?.id ?? "") === ""
	const unswept = [
		...(cut ? yield* listingCut("customers", "cursor_dropped", SWEPT) : []),
		...(capped ? yield* listingCut("customers", "plans_per_customer_cap", ["subscription"]) : []),
	]
	return pageOf(cursor, { ops, rows: body.list.length, next, unswept })
})

const subscriptionsPage = Effect.fnUntraced(function* (input: PageInput, cursor: AutumnCursor) {
	const body = yield* input.api.post(
		"/v1/subscriptions.list",
		{
			start_cursor: cursor.after ?? "",
			limit: SUBSCRIPTIONS_PAGE_SIZE,
			// Every state: an ended plan is recognised beside a live one reusing its id.
			statuses: ALL_SUBSCRIPTION_STATUSES,
		},
		AutumnSubscriptionsPage,
	)
	const expired = body.list.some((subscription) => subscription.status === "expired")
	// Live plans were written with their customer; only the ended ones are this phase's.
	const ops = expired
		? subscriptionOps(body.list, { pricing: yield* input.pricing, observedAt: input.observedAt }).filter(
				(op) => op.status === "canceled",
			)
		: []
	// A page may hold fewer rows than asked for — even none — while more remain.
	const next = body.has_more === true ? (body.next_cursor ?? null) : null
	const unswept =
		body.has_more === true && next === null
			? yield* listingCut("subscriptions", "has_more_without_cursor", ["subscription"])
			: []
	return pageOf(cursor, { ops, rows: body.list.length, next, unswept })
})

export const pullPage = Effect.fn("Autumn.pullPage")(function* (input: {
	readonly api: AutumnApi
	readonly pricing: Effect.Effect<Pricing, CustomerProviderError>
	readonly cursor: string | null
	readonly config: ConnectionConfig
	readonly env: AutumnEnv
}) {
	const nowMs = yield* Clock.currentTimeMillis
	// Taken before any request: the ops' `observedAt` (a listing proves its records live as of it,
	// and ingest drops a subscription read older than one it applied).
	const at = new Date(nowMs)
	const decoded = input.cursor === null ? Option.some(START) : decodeCursor(input.cursor)
	if (Option.isNone(decoded)) {
		yield* Effect.logWarning("Autumn pull cursor unreadable: the pull starts over", {
			phase: START.phase,
		})
	}
	const cursor = Option.getOrElse(decoded, () => START)
	const pageInput: PageInput = { ...input, at, observedAt: at.toISOString() }
	const page: PullPage =
		cursor.phase === "features"
			? yield* featuresPage(input.api, cursor)
			: cursor.phase === "customers"
				? yield* customersPage(pageInput, cursor)
				: yield* subscriptionsPage(pageInput, cursor)
	yield* Effect.annotateCurrentSpan({
		"autumn.phase": cursor.phase,
		"autumn.received": page.progress.done - doneOf(cursor),
		"autumn.ops": page.ops.length,
		"autumn.resumed": cursor.after !== null,
		"autumn.sweep": page.sweep?.join(",") ?? "",
	})
	return page
})
