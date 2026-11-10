/**
 * The scheduled pull and the connect-time backfill: a walk of the Stripe account, page by page, in
 * four phases held in the run's cursor so an evicted object resumes where it stopped.
 *
 * | Phase | Request | Writes |
 * |---|---|---|
 * | `customers` | `/customers` | accounts (matched by shared id or domain) and their billing contacts |
 * | `products` | `/products` | nothing — it collects the product names the next phase needs |
 * | `subscriptions` | `/subscriptions?status=all` (+ discounts and the default payment method) | subscriptions, MRR |
 * | `invoices` | `/invoices` | invoices |
 *
 * Paging is Stripe's own `starting_after`, which is id-based: a record deleted mid-walk cannot
 * shift a page past another one, so no page has to re-read the one before it (unlike Clerk's
 * offsets).
 *
 * The `products` phase exists because a product's name is five levels deep from a subscription list
 * (`data.items.data.price.product`) and Stripe expands four, so the names are gathered once per
 * pull and carried in the cursor — which also means a resumed pull still has them. Past
 * {@link PRODUCT_LIMIT} products it stops collecting and those subscriptions fall back to their
 * price's nickname.
 *
 * **A backfill (`since: null`) lists everything**, so its last page sets `sweep: ["account"]` and
 * core removes the customers it did not see (deleted while no webhook reached Hazel). Contacts are
 * not swept: a Stripe contact row is usually the Clerk member's too, and removing Stripe's ref
 * would soft-delete the person. Invoices are bounded to the last {@link INVOICE_BACKFILL_DAYS}
 * days — nothing older is read, so a decade of invoices cannot stall a connection.
 *
 * **A scheduled pull (`since` set) is incremental**: none of Stripe's list endpoints filter by a
 * change time, only by `created`, so it carries what was created since the last success (minus
 * core's overlap) and never sets `sweep`. Updates to older records ride on the webhooks; the
 * backfill is the one complete reconciliation.
 */
import type { ConnectionConfig, IngestOp, IsoTimestamp, SyncProgress } from "@hazel/domain/customers"
import { Clock, Effect, Option, Schema } from "effect"
import type { PullPage } from "../providers"
import type { StripeGet, StripeQuery } from "./http"
import { customerOps, invoiceOp, subscriptionOp } from "./map"
import { StripeCustomersPage, StripeInvoicesPage, StripeProductsPage, StripeSubscriptionsPage } from "./wire"

/** Stripe's list endpoints cap `limit` at 100. */
export const PAGE_SIZE = 100
/** Product names carried in the cursor; past it a plan falls back to its price's nickname. */
export const PRODUCT_LIMIT = 300
/** How far back a backfill reads invoices. Older ones answer no signal and no rollup. */
export const INVOICE_BACKFILL_DAYS = 365

export const StripePhase = Schema.Literals(["customers", "products", "subscriptions", "invoices"])
export type StripePhase = typeof StripePhase.Type

/** Which phase the walk is in, Stripe's paging cursor, and the product names gathered so far. */
export const StripeCursor = Schema.Struct({
	phase: StripePhase,
	/** The last id of the page before, Stripe's `starting_after`. */
	after: Schema.NullOr(Schema.String),
	/** Records done in this phase, for the progress the data-sources page shows. */
	done: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
	/** Product id → name, from the `products` phase. */
	products: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})
export type StripeCursor = typeof StripeCursor.Type

const START: StripeCursor = { phase: "customers", after: null }

const decodeDocument = Schema.decodeUnknownOption(Schema.fromJsonString(StripeCursor))

/** An unreadable cursor (a format change between deploys) restarts the walk; ingest is idempotent. */
export const decodeCursor = (cursor: string | null): StripeCursor =>
	cursor === null ? START : Option.getOrElse(decodeDocument(cursor), () => START)

export const encodeCursor = (cursor: StripeCursor): string => JSON.stringify(cursor)

const NEXT_PHASE = {
	customers: "products",
	products: "subscriptions",
	subscriptions: "invoices",
	invoices: null,
} satisfies Readonly<Record<StripePhase, StripePhase | null>>

const doneOf = (cursor: StripeCursor): number => cursor.done ?? 0

const productsOf = (cursor: StripeCursor): Readonly<Record<string, string>> => cursor.products ?? {}

/** Where the walk goes after a page: on in this phase, into the next one, or done. */
const advance = (
	cursor: StripeCursor,
	page: { readonly lastId: string | null; readonly hasMore: boolean; readonly received: number },
	products: Readonly<Record<string, string>>,
): string | null => {
	const done = doneOf(cursor) + page.received
	if (page.hasMore && page.lastId !== null) {
		return encodeCursor({ phase: cursor.phase, after: page.lastId, done, products })
	}
	const next = NEXT_PHASE[cursor.phase]
	return next === null ? null : encodeCursor({ phase: next, after: null, done: 0, products })
}

const pageOf = (input: {
	readonly cursor: StripeCursor
	readonly ops: ReadonlyArray<IngestOp>
	readonly lastId: string | null
	readonly hasMore: boolean
	readonly received: number
	readonly products: Readonly<Record<string, string>>
	readonly complete: boolean
}): PullPage => {
	const nextCursor = advance(input.cursor, input, input.products)
	const progress: SyncProgress = {
		step: input.cursor.phase,
		done: doneOf(input.cursor) + input.received,
		// Stripe's lists carry no total; only `has_more`.
		total: null,
	}
	// Only the last page of a backfill, which listed every customer of the account.
	return nextCursor === null && input.complete
		? { ops: input.ops, nextCursor, progress, sweep: ["account"] }
		: { ops: input.ops, nextCursor, progress }
}

/** Unix seconds, which is what Stripe's `created` filters take. */
const secondsOf = (date: Date): string => String(Math.floor(date.getTime() / 1000))

const query = (
	cursor: StripeCursor,
	options: { readonly since?: Date | null; readonly extra?: StripeQuery } = {},
): StripeQuery => [
	["limit", String(PAGE_SIZE)],
	...(cursor.after === null ? [] : [["starting_after", cursor.after] as const]),
	...(options.since == null ? [] : [["created[gte]", secondsOf(options.since)] as const]),
	...(options.extra ?? []),
]

const lastIdOf = (rows: ReadonlyArray<{ readonly id?: string | null }>): string | null => {
	const last = rows[rows.length - 1]
	return last?.id ?? null
}

const customersPage = (
	get: StripeGet,
	cursor: StripeCursor,
	config: ConnectionConfig,
	since: Date | null,
	at: IsoTimestamp,
) =>
	Effect.map(get("/customers", query(cursor, { since }), StripeCustomersPage), (body) =>
		pageOf({
			cursor,
			ops: body.data.flatMap((customer) => customerOps(customer, config, at)),
			lastId: lastIdOf(body.data),
			hasMore: body.has_more === true,
			received: body.data.length,
			products: productsOf(cursor),
			complete: since === null,
		}),
	)

/** Names only: this phase writes nothing, it fills the map the subscriptions phase reads. */
const productsPage = (get: StripeGet, cursor: StripeCursor, since: Date | null) =>
	Effect.map(get("/products", query(cursor), StripeProductsPage), (body) => {
		const products = new Map(Object.entries(productsOf(cursor)))
		for (const product of body.data) {
			if (products.size >= PRODUCT_LIMIT) break
			if (product.name != null && product.name.trim() !== "")
				products.set(product.id, product.name.trim())
		}
		return pageOf({
			cursor,
			ops: [],
			lastId: lastIdOf(body.data),
			hasMore: body.has_more === true && products.size < PRODUCT_LIMIT,
			received: body.data.length,
			products: Object.fromEntries(products),
			complete: since === null,
		})
	})

const subscriptionsPage = (get: StripeGet, cursor: StripeCursor, since: Date | null) =>
	Effect.map(
		get(
			"/subscriptions",
			query(cursor, {
				since,
				extra: [
					// Canceled ones too: an account churns by its subscription's amount.
					["status", "all"],
					["expand[]", "data.default_payment_method"],
					["expand[]", "data.discounts"],
				],
			}),
			StripeSubscriptionsPage,
		),
		(body) => {
			const products = productsOf(cursor)
			const names = new Map(Object.entries(products))
			return pageOf({
				cursor,
				ops: body.data.flatMap((subscription) => {
					const op = subscriptionOp(subscription, names)
					return op === null ? [] : [op]
				}),
				lastId: lastIdOf(body.data),
				hasMore: body.has_more === true,
				received: body.data.length,
				products,
				complete: since === null,
			})
		},
	)

const invoicesPage = (get: StripeGet, cursor: StripeCursor, since: Date | null, nowMs: number) =>
	Effect.map(
		get(
			"/invoices",
			query(cursor, {
				since: since ?? new Date(nowMs - INVOICE_BACKFILL_DAYS * 86_400_000),
			}),
			StripeInvoicesPage,
		),
		(body) =>
			pageOf({
				cursor,
				ops: body.data.flatMap((invoice) => {
					const op = invoiceOp(invoice)
					return op === null ? [] : [op]
				}),
				lastId: lastIdOf(body.data),
				hasMore: body.has_more === true,
				received: body.data.length,
				products: productsOf(cursor),
				complete: since === null,
			}),
	)

export const pullPage = Effect.fn("Stripe.pullPage")(function* (input: {
	readonly get: StripeGet
	readonly cursor: string | null
	readonly since: Date | null
	readonly config: ConnectionConfig
}) {
	const cursor = decodeCursor(input.cursor)
	const nowMs = yield* Clock.currentTimeMillis
	// A listing proves its records live as of the request: the ops' `observedAt`.
	const at = new Date(nowMs).toISOString()
	const { get, since, config } = input
	const page: PullPage =
		cursor.phase === "customers"
			? yield* customersPage(get, cursor, config, since, at)
			: cursor.phase === "products"
				? yield* productsPage(get, cursor, since)
				: cursor.phase === "subscriptions"
					? yield* subscriptionsPage(get, cursor, since)
					: yield* invoicesPage(get, cursor, since, nowMs)
	yield* Effect.annotateCurrentSpan({
		"stripe.phase": cursor.phase,
		"stripe.incremental": since !== null,
		"stripe.received": page.progress.done - doneOf(cursor),
		"stripe.ops": page.ops.length,
		"stripe.products_known": Object.keys(productsOf(cursor)).length,
		"stripe.resumed": cursor.after !== null,
		"stripe.sweep_complete": page.sweep !== undefined,
	})
	return page
})
