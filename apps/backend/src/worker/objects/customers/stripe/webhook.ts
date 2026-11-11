/**
 * Stripe events → `IngestOp`s: one webhook delivery (`receiveWebhook`), and the events a scheduled
 * pull reads from `/v1/events` (`./pull.ts`), through the same {@link readEvent} and
 * {@link opsOfReads}.
 *
 * The connection's endpoint signing secret verifies the `Stripe-Signature` header over the raw body
 * (`./signature.ts`) before anything is parsed. A bad signature, a replayed delivery (its timestamp
 * outside ±5 minutes), a payload that will not decode, or an event from another Stripe account or
 * the other mode than the key opens is refused, and the route answers 400. Stripe retries a non-2xx
 * with backoff for up to three days. An event type Hazel does not handle is acknowledged.
 *
 * **An event only says which object changed; Hazel reads its current state.** A payload is the
 * object as it was when the event happened, deliveries arrive in any order and are retried for days,
 * and a subscription payload carries its discounts and card as bare ids. So every event re-reads its
 * object, expanded the way a pull reads it, and writes that: events applied in any order, or twice,
 * land on the same state, and a webhook writes exactly what a pull would.
 *
 * | Event | Reads | Writes |
 * |---|---|---|
 * | `customer.created` / `updated` / `deleted` | `GET /v1/customers/{id}` | account + billing contact; a deleted customer → its deletion |
 * | `customer.updated` changing `invoice_settings` or `default_source` | also `GET /v1/subscriptions?customer=…` | the customer's subscriptions, for the default card they fall back to |
 * | `customer.subscription.created` / `updated` / `deleted` / `paused` / `resumed` | `GET /v1/subscriptions/{id}` | the subscription |
 * | `invoice.finalized` / `paid` / `payment_failed` / `payment_action_required` / `voided` / `marked_uncollectible` | `GET /v1/invoices/{id}` | the invoice |
 * | `payment_method.attached` / `updated` / `automatically_updated` / `detached` | `GET /v1/subscriptions?customer=…` | the customer's subscriptions, for the card on file |
 *
 * Writing subscriptions also reads their plans' names, one `GET /v1/products?ids[]=…` per 100
 * products for a whole delivery or events page ({@link productNamesOf}).
 *
 * Every op is observed at the time taken before the reads, so ingest drops one older than a read it
 * already applied: a slow delivery cannot overwrite a newer one.
 *
 * The read is also what keeps another account's events out: Stripe stamps `account` only on a
 * connected account's events, so an unstamped event could still come from an unrelated account whose
 * signing secret was pasted here, but its object id answers 404 under this key, and a 404 is skipped
 * (nothing written, acknowledged). Any other failure of the reads depends on whether a retry can fix
 * it: a transient one (unreachable, timed out, 429, 5xx) refuses the delivery, nothing written, so
 * Stripe delivers it again later; a permanent one (the key lost a permission) is logged and
 * acknowledged, and the next pull reports it on the connection. The reads are never retried in place
 * and give up after 5 s (`WEBHOOK_REQUESTS`): a delivery must answer before Stripe times out.
 *
 * Not handled: `invoice.created` and `invoice.deleted` (drafts, which Hazel does not record),
 * `invoice.upcoming` (a preview with no id), `customer.subscription.trial_will_end` (a reminder that
 * changes nothing).
 */
import type { ConnectionConfig, IngestOp, IsoTimestamp } from "@hazel/domain/customers"
import { Array as Arr, Clock, Effect, Option, Redacted, Schema } from "effect"
import {
	type CustomerProviderError,
	type CustomerWebhookRejectedError as RejectedError,
	CustomerWebhookRejectedError,
} from "../provider-errors"
import { issueSummary } from "../provider-http"
import type { StripeGet } from "./http"
import { accountDeletedOp, customerOps, invoiceOp, primaryProductIdOf, subscriptionOp } from "./map"
import { verifyStripeSignature } from "./signature"
import {
	idOf,
	StripeCustomer,
	StripeEvent,
	StripeInvoice,
	StripePaymentMethod,
	StripeProductsPage,
	StripeSubscription,
	StripeSubscriptionsPage,
	subscriptionExpands,
} from "./wire"

const CUSTOMER_EVENTS: ReadonlySet<string> = new Set([
	"customer.created",
	"customer.updated",
	"customer.deleted",
])
const SUBSCRIPTION_EVENTS: ReadonlySet<string> = new Set([
	"customer.subscription.created",
	"customer.subscription.updated",
	"customer.subscription.deleted",
	"customer.subscription.paused",
	"customer.subscription.resumed",
])
const INVOICE_EVENTS: ReadonlySet<string> = new Set([
	"invoice.finalized",
	"invoice.paid",
	"invoice.payment_failed",
	"invoice.payment_action_required",
	"invoice.voided",
	"invoice.marked_uncollectible",
])
const PAYMENT_METHOD_EVENTS: ReadonlySet<string> = new Set([
	"payment_method.attached",
	"payment_method.updated",
	"payment_method.automatically_updated",
	"payment_method.detached",
])

/** Every event type Hazel handles: the webhook endpoint's subscription, and the pull's `types[]`. */
export const STRIPE_EVENT_TYPES: ReadonlyArray<string> = [
	...CUSTOMER_EVENTS,
	...SUBSCRIPTION_EVENTS,
	...INVOICE_EVENTS,
	...PAYMENT_METHOD_EVENTS,
]

/** Refuse an event: logged with the reason (never the payload), a delivery is answered 400 with `message`. */
const reject = (reason: string, message: string, detail: Record<string, unknown> = {}) =>
	Effect.logWarning("Stripe event refused", { reason, ...detail }).pipe(
		Effect.andThen(Effect.annotateCurrentSpan("stripe.event.rejected", reason)),
		Effect.andThen(Effect.fail(new CustomerWebhookRejectedError({ message }))),
	)

const decodeEvent = Schema.decodeUnknownEffect(Schema.fromJsonString(StripeEvent))

const decodeAs = <A>(schema: Schema.Decoder<A>, data: unknown, type: string) =>
	Schema.decodeUnknownEffect(schema)(data).pipe(
		Effect.catchTag("SchemaError", (error) =>
			reject("bad_payload", `The ${type} payload is not the shape Stripe documents`, {
				type,
				issues: issueSummary(error),
			}),
		),
	)

const ObjectId = Schema.Struct({ id: Schema.String })

/** What a `payment_method.detached` changed: the customer it was attached to. */
const decodePreviousCustomer = Schema.decodeUnknownOption(
	Schema.Struct({ customer: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
)

/** A read's result; `None` when Stripe does not know the object under this key (another account's, or gone). */
const current = <A>(read: Effect.Effect<A, CustomerProviderError>) =>
	read.pipe(
		Effect.map(Option.some),
		Effect.catchTag("CustomerProviderError", (error) =>
			error.httpStatus === 404 ? Effect.succeed(Option.none<A>()) : Effect.fail(error),
		),
	)

/** Stripe's `/v1/products` takes at most 100 `ids[]` (its `limit`). */
const PRODUCTS_PER_LOOKUP = 100

/**
 * Product id → name for the subscriptions' plans, one request per 100 products. A product Stripe
 * does not return is left out; a failed request fails the caller, so a plan is never named from a
 * lookup that did not happen.
 */
const productNamesOf = Effect.fn("Stripe.productNames")(function* (
	get: StripeGet,
	subscriptions: ReadonlyArray<StripeSubscription>,
) {
	const ids = [
		...new Set(
			subscriptions.flatMap((subscription) => {
				const productId = primaryProductIdOf(subscription)
				return productId === null ? [] : [productId]
			}),
		),
	]
	const pages = yield* Effect.forEach(Arr.chunksOf(ids, PRODUCTS_PER_LOOKUP), (chunk) =>
		get(
			"/products",
			[["limit", String(PRODUCTS_PER_LOOKUP)], ...chunk.map((id) => ["ids[]", id] as const)],
			StripeProductsPage,
		),
	)
	return new Map(
		pages.flatMap((page) =>
			page.data.flatMap((product) =>
				product.name == null || product.name.trim() === ""
					? []
					: [[product.id, product.name.trim()] as const],
			),
		),
	)
})

/**
 * What reading an event's object found: ops ready to apply, and subscriptions whose plans are still
 * to be named ({@link opsOfReads} names a whole batch's in one lookup).
 */
export interface EventRead {
	readonly ops: ReadonlyArray<IngestOp>
	readonly subscriptions: ReadonlyArray<StripeSubscription>
}

export const NOTHING_READ: EventRead = { ops: [], subscriptions: [] }

/**
 * The reads' ops, in order (each read's ops, then its subscriptions), every subscription read at
 * `observedAt` and named from one product lookup for the whole batch: the path every subscription
 * write takes.
 */
export const opsOfReads = Effect.fn("Stripe.opsOfReads")(function* (
	get: StripeGet,
	reads: ReadonlyArray<EventRead>,
	observedAt: IsoTimestamp,
) {
	const names = yield* productNamesOf(
		get,
		reads.flatMap((read) => read.subscriptions),
	)
	return reads.flatMap((read): Array<IngestOp> => [
		...read.ops,
		...read.subscriptions.flatMap((subscription) => {
			const op = subscriptionOp(subscription, names, observedAt)
			return op === null ? [] : [op]
		}),
	])
})

/** A customer's subscriptions, expanded, for the card on file; none for a customer the key cannot see. */
const subscriptionsOf = (get: StripeGet, customerId: string) =>
	current(
		get(
			"/subscriptions",
			[["customer", customerId], ["status", "all"], ["limit", "100"], ...subscriptionExpands("data.")],
			StripeSubscriptionsPage,
		),
	).pipe(Effect.map(Option.match({ onNone: () => [], onSome: (page) => page.data })))

/** A `customer.updated` that changed the customer's default card, which its subscriptions fall back to. */
const changedDefaultCard = (type: string, previous: unknown): boolean =>
	type === "customer.updated" &&
	typeof previous === "object" &&
	previous !== null &&
	("invoice_settings" in previous || "default_source" in previous)

/**
 * Read one event's object at `observedAt`. `type` drives everything; an unknown type reads nothing.
 * Fails with the read's `CustomerProviderError` (404 aside) for the caller to classify, and with
 * `CustomerWebhookRejectedError` for a payload with no object id.
 */
export const readEvent = Effect.fn("Stripe.readEvent")(function* (
	get: StripeGet,
	event: StripeEvent,
	config: ConnectionConfig,
	observedAt: IsoTimestamp,
): Effect.fn.Return<EventRead, CustomerProviderError | RejectedError> {
	const { type } = event
	const data = event.data.object
	if (CUSTOMER_EVENTS.has(type)) {
		const { id } = yield* decodeAs(ObjectId, data, type)
		const customer = yield* current(get(`/customers/${encodeURIComponent(id)}`, [], StripeCustomer))
		if (Option.isNone(customer)) return NOTHING_READ
		if (customer.value.deleted === true) {
			return { ops: [accountDeletedOp(id, observedAt)], subscriptions: [] }
		}
		return {
			ops: customerOps(customer.value, config, observedAt),
			// A new default card is what its subscriptions without their own are charged on.
			subscriptions: changedDefaultCard(type, event.data.previous_attributes)
				? yield* subscriptionsOf(get, id)
				: [],
		}
	}
	if (SUBSCRIPTION_EVENTS.has(type)) {
		const { id } = yield* decodeAs(ObjectId, data, type)
		const subscription = yield* current(
			get(`/subscriptions/${encodeURIComponent(id)}`, subscriptionExpands(""), StripeSubscription),
		)
		return { ops: [], subscriptions: Option.toArray(subscription) }
	}
	if (INVOICE_EVENTS.has(type)) {
		const { id } = yield* decodeAs(ObjectId, data, type)
		const invoice = yield* current(get(`/invoices/${encodeURIComponent(id)}`, [], StripeInvoice))
		if (Option.isNone(invoice)) return NOTHING_READ
		const op = invoiceOp(invoice.value, { paymentFailed: type === "invoice.payment_failed", observedAt })
		return { ops: op === null ? [] : [op], subscriptions: [] }
	}
	if (PAYMENT_METHOD_EVENTS.has(type)) {
		const method = yield* decodeAs(StripePaymentMethod, data, type)
		// A detached method has no customer left; the event's previous attributes name it.
		const customerId =
			idOf(method.customer) ??
			Option.getOrUndefined(decodePreviousCustomer(event.data.previous_attributes))?.customer ??
			null
		if (customerId === null) return NOTHING_READ
		return { ops: [], subscriptions: yield* subscriptionsOf(get, customerId) }
	}
	return NOTHING_READ
})

/** A read a later attempt can get through: unreachable, timed out, rate limited, or a 5xx. */
export const isTransient = (error: CustomerProviderError): boolean =>
	error.code !== "auth" && error.retryable !== false

/**
 * Verify the delivery, then map it. Core refuses a connection with no signing secret before this.
 *
 * `accountId` is the Stripe account the key opens (`validate`'s `externalAccountId`) and `livemode`
 * the mode it is for (null for a key whose prefix does not say): an event stamped with another
 * account (a Connect platform's endpoint relays its connected accounts' events), or from the other
 * mode, is refused, so a test-mode endpoint's secret next to a live key cannot write test data into
 * a production connection. An unstamped event is checked by its read (see the module comment).
 */
export const receiveWebhook = Effect.fn("Stripe.receiveWebhook")(function* (input: {
	readonly get: StripeGet
	readonly headers: Readonly<Record<string, string>>
	readonly body: string
	readonly webhookSecret: Redacted.Redacted<string>
	readonly accountId: string | null
	readonly livemode: boolean | null
	readonly config: ConnectionConfig
}): Effect.fn.Return<ReadonlyArray<IngestOp>, RejectedError> {
	const nowMs = yield* Clock.currentTimeMillis
	yield* verifyStripeSignature({
		secret: Redacted.value(input.webhookSecret),
		headers: input.headers,
		body: input.body,
		nowMs,
	}).pipe(Effect.catchTag("StripeSignatureError", (error) => reject(error.reason, error.message)))
	const event = yield* decodeEvent(input.body).pipe(
		Effect.catchTag("SchemaError", (error) =>
			reject("bad_envelope", "The delivery is not a Stripe event", {
				issues: issueSummary(error),
			}),
		),
	)
	yield* Effect.annotateCurrentSpan({
		"stripe.event.type": event.type,
		"stripe.event.id": event.id,
		"stripe.event.api_version": event.api_version ?? "",
	})
	const account = event.account ?? null
	if (account !== null && account !== input.accountId) {
		return yield* reject(
			"account_mismatch",
			"The event belongs to another Stripe account than the connection's key opens",
			{ type: event.type, account, expected: input.accountId },
		)
	}
	if (input.livemode !== null && event.livemode != null && event.livemode !== input.livemode) {
		return yield* reject(
			"mode_mismatch",
			input.livemode
				? "The event comes from Stripe test mode, and the connection's key is a live one"
				: "The event comes from Stripe live mode, and the connection's key is a test one",
			{ type: event.type },
		)
	}
	// Taken before the reads: the time the ops are observed at.
	const observedAt = new Date(nowMs).toISOString()
	return yield* readEvent(input.get, event, input.config, observedAt).pipe(
		Effect.flatMap((read) => opsOfReads(input.get, [read], observedAt)),
		Effect.catchTag("CustomerProviderError", (error) =>
			isTransient(error)
				? reject(
						"stripe_unavailable",
						"Stripe could not be read for the event's current state; retry later",
						{
							type: event.type,
							code: error.code,
							status: error.httpStatus,
						},
					)
				: Effect.logWarning("Stripe event acknowledged unread", {
						type: event.type,
						code: error.code,
						message: error.message,
					}).pipe(Effect.as([])),
		),
	)
})
