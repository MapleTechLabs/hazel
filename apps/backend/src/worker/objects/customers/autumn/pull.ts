/**
 * The pulls: one full walk of the Autumn organization's environment, page by page, in three phases
 * held in the run's cursor so an evicted object resumes where it stopped.
 *
 * | Phase | Request | Writes | Requests per page |
 * |---|---|---|---|
 * | `features` | `POST /v1/features.list` | a metric definition per metered feature | 1 |
 * | `customers` | `POST /v1/customers.list` | accounts (matched by shared id or domain), seats, feature usage | 1 |
 * | `subscriptions` | `POST /v1/subscriptions.list` + one `POST /v1/plans.list` | subscriptions, MRR | 2 |
 *
 * **Why the subscriptions are a phase of their own.** A customer lists only the plans it holds
 * *now* — `active`, `past_due` and `scheduled` (`RELEVANT_STATUSES` in Autumn's server) — so a plan
 * that ended is invisible there and its Hazel row would keep its MRR for ever.
 * `POST /v1/subscriptions.list` is the one read that reports `expired` rows too, across every
 * customer, with the customer each belongs to; asking it for all four states is what makes churn
 * visible to a pull. The page's plans are priced from one `plans.list` lookup (archived plans
 * included, for a grandfathered customer).
 *
 * **Paging is Autumn's own opaque cursor** (`start_cursor` → `next_cursor`), and every listing asks
 * for its oldest rows first (`sort_order: "asc"` where the endpoint takes one), so a record created
 * mid-walk lands at the end rather than shifting the rows not read yet. A keyset cursor cannot skip
 * a row behind a deletion either, which is why — unlike Clerk's offset paging — no page re-reads the
 * one before it. `subscriptions.list` may answer a page with fewer rows than asked for (even none)
 * while `has_more` is true, so the loop follows `has_more`, never the row count.
 *
 * **Every pull lists everything.** None of Autumn's list endpoints filters by a change time
 * (`customers.list` filters by creation time only), so `since` cannot narrow a walk: each one reads
 * the whole environment and ingest writes only what actually changed (unchanged rows never reach the
 * change log). Webhooks carry the live signal; the walk is the reconciliation behind them, which is
 * why its period is hours rather than minutes. Because the customer phase lists every customer, the
 * walk's last page sets `sweep: ["account"]` and core removes the customers it did not see (deleted
 * while no delivery reached Hazel). Contacts are not swept: Autumn holds none of its own.
 */
import type { ConnectionConfig, IngestOp, IsoTimestamp, SyncProgress } from "@hazel/domain/customers"
import { Clock, Effect, Option, Schema } from "effect"
import type { PullPage } from "../providers"
import type { AutumnApi } from "./http"
import { balanceOps, accountOp, featureDefinitionOps, featureNamesOf } from "./map"
import { ALL_SUBSCRIPTION_STATUSES, SUBSCRIPTIONS_PAGE_SIZE, subscriptionOpsOf } from "./read"
import { type AutumnEnv, AutumnCustomersPage, AutumnFeaturesPage, AutumnSubscriptionsPage } from "./wire"

/** Customers per page. Autumn's ceiling is 5000; a hundred keeps a page's work (and its retry) small. */
export const PAGE_SIZE = 100

const AutumnPhase = Schema.Literals(["features", "customers", "subscriptions"])
type AutumnPhase = typeof AutumnPhase.Type

/** Which phase the walk is in, and Autumn's opaque paging cursor; carried on the run as JSON. */
const AutumnCursor = Schema.Struct({
	phase: AutumnPhase,
	/** `next_cursor` from the page before; `null` for the phase's first page. */
	after: Schema.NullOr(Schema.String),
	/** Records done in this phase, for the progress the data-sources page shows. */
	done: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
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

/**
 * One page's ops and where the walk goes after it: on in this phase, into the next one, or done.
 * The last page of the whole walk sweeps the accounts: the customer phase listed every one.
 */
const pageOf = (
	cursor: AutumnCursor,
	ops: ReadonlyArray<IngestOp>,
	rows: number,
	next: string | null,
): PullPage => {
	const done = doneOf(cursor) + rows
	const after = NEXT_PHASE[cursor.phase]
	const nextCursor =
		next !== null
			? encodeCursor({ phase: cursor.phase, after: next, done })
			: after === null
				? null
				: encodeCursor({ phase: after, after: null, done: 0 })
	// Autumn's lists carry no total; only `next_cursor` / `has_more`.
	const progress: SyncProgress = { step: cursor.phase, done, total: null }
	return nextCursor === null
		? { ops, nextCursor, progress, sweep: ["account"] }
		: { ops, nextCursor, progress }
}

/** Every metered feature becomes a metric definition, so a chart is named after the feature. */
const featuresPage = Effect.fnUntraced(function* (api: AutumnApi, cursor: AutumnCursor) {
	const body = yield* api.post("/v1/features.list", {}, AutumnFeaturesPage)
	return pageOf(cursor, featureDefinitionOps(body.list), body.list.length, null)
})

const customersPage = Effect.fnUntraced(function* (
	api: AutumnApi,
	cursor: AutumnCursor,
	options: {
		readonly config: ConnectionConfig
		readonly env: AutumnEnv
		readonly at: Date
		readonly observedAt: IsoTimestamp
	},
) {
	const body = yield* api.post(
		"/v1/customers.list",
		{
			start_cursor: cursor.after ?? "",
			limit: PAGE_SIZE,
			// Oldest first, so a customer created mid-walk lands past the cursor instead of before it.
			sort_order: "asc",
		},
		AutumnCustomersPage,
	)
	const ops = body.list.flatMap((customer): Array<IngestOp> => {
		const id = customer.id ?? null
		// A key opens one organization and one environment; anything else is not this connection's.
		if (id === null || id.trim() === "" || (customer.env != null && customer.env !== options.env)) {
			return []
		}
		const named = { ...customer, id }
		const names = featureNamesOf(
			Object.values(customer.balances ?? {}).map((balance) => ({
				id: balance.feature_id,
				name: balance.feature?.name ?? null,
			})),
		)
		return [
			accountOp(named, options.config, options.env, options.observedAt),
			...balanceOps(named, { names, at: options.at }),
		]
	})
	return pageOf(cursor, ops, body.list.length, body.next_cursor ?? null)
})

const subscriptionsPage = Effect.fnUntraced(function* (
	api: AutumnApi,
	cursor: AutumnCursor,
	options: { readonly observedAt: IsoTimestamp },
) {
	const body = yield* api.post(
		"/v1/subscriptions.list",
		{
			start_cursor: cursor.after ?? "",
			limit: SUBSCRIPTIONS_PAGE_SIZE,
			// Ended plans too: a Hazel row left `active` would keep its MRR for ever.
			statuses: ALL_SUBSCRIPTION_STATUSES,
		},
		AutumnSubscriptionsPage,
	)
	const ops = yield* subscriptionOpsOf(api, body.list, options)
	// A page may hold fewer rows than asked for — even none — while more remain.
	const next = body.has_more === true ? (body.next_cursor ?? null) : null
	return pageOf(cursor, ops, body.list.length, next)
})

export const pullPage = Effect.fn("Autumn.pullPage")(function* (input: {
	readonly api: AutumnApi
	readonly cursor: string | null
	readonly config: ConnectionConfig
	readonly env: AutumnEnv
}) {
	const nowMs = yield* Clock.currentTimeMillis
	// Taken before any request: the ops' `observedAt` (a listing proves its records live as of it,
	// and ingest drops a subscription read older than one it applied).
	const at = new Date(nowMs)
	const observedAt: IsoTimestamp = at.toISOString()
	const decoded = input.cursor === null ? Option.some(START) : decodeCursor(input.cursor)
	if (Option.isNone(decoded)) {
		yield* Effect.logWarning("Autumn pull cursor unreadable: the pull starts over", {
			phase: START.phase,
		})
	}
	const cursor = Option.getOrElse(decoded, () => START)
	const page: PullPage =
		cursor.phase === "features"
			? yield* featuresPage(input.api, cursor)
			: cursor.phase === "customers"
				? yield* customersPage(input.api, cursor, {
						config: input.config,
						env: input.env,
						at,
						observedAt,
					})
				: yield* subscriptionsPage(input.api, cursor, { observedAt })
	yield* Effect.annotateCurrentSpan({
		"autumn.phase": cursor.phase,
		"autumn.received": page.progress.done - doneOf(cursor),
		"autumn.ops": page.ops.length,
		"autumn.resumed": cursor.after !== null,
		"autumn.sweep_complete": page.sweep !== undefined,
	})
	return page
})
