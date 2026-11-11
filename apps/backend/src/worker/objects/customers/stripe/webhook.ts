/**
 * Stripe events → `IngestOp`s: one webhook delivery (`receiveWebhook`), and the events a scheduled
 * pull reads from `/v1/events` (`./pull.ts`), through the same {@link opsOfEvent}.
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
 * | `customer.subscription.created` / `updated` / `deleted` / `paused` / `resumed` | `GET /v1/subscriptions/{id}` | the subscription |
 * | `invoice.finalized` / `paid` / `payment_failed` / `payment_action_required` / `voided` / `marked_uncollectible` | `GET /v1/invoices/{id}` | the invoice |
 * | `payment_method.attached` / `updated` / `automatically_updated` / `detached` | `GET /v1/subscriptions?customer=…` | the customer's subscriptions, for the card on file |
 *
 * Writing subscriptions also reads their plans' names, one `GET /v1/products?ids[]=…` for all of them
 * ({@link productNamesOf}, the pull's too).
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
import { Clock, Effect, Option, Redacted, Schema } from "effect"
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

/**
 * Product id → name for the subscriptions' plans, in one request (a page holds at most 100
 * subscriptions, so at most 100 products). A product Stripe does not return is left out; a failed
 * request fails the caller, so a plan is never named from a lookup that did not happen.
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
	if (ids.length === 0) return new Map<string, string>()
	const page = yield* get(
		"/products",
		[["limit", "100"], ...ids.map((id) => ["ids[]", id] as const)],
		StripeProductsPage,
	)
	return new Map(
		page.data.flatMap((product) =>
			product.name == null || product.name.trim() === ""
				? []
				: [[product.id, product.name.trim()] as const],
		),
	)
})

/** Subscription ops with their plan names resolved: the one path every subscription write takes. */
export const subscriptionOps = Effect.fn("Stripe.subscriptionOps")(function* (
	get: StripeGet,
	subscriptions: ReadonlyArray<StripeSubscription>,
) {
	const names = yield* productNamesOf(get, subscriptions)
	return subscriptions.flatMap((subscription): Array<IngestOp> => {
		const op = subscriptionOp(subscription, names)
		return op === null ? [] : [op]
	})
})

/**
 * One event's ops, from its object's current state read at `observedAt`. `type` drives everything;
 * an unknown type is no op. Fails with the read's `CustomerProviderError` (404 aside) for the caller
 * to classify, and with `CustomerWebhookRejectedError` for a payload with no object id.
 */
export const opsOfEvent = Effect.fn("Stripe.opsOfEvent")(function* (
	get: StripeGet,
	event: StripeEvent,
	config: ConnectionConfig,
	observedAt: IsoTimestamp,
): Effect.fn.Return<ReadonlyArray<IngestOp>, CustomerProviderError | RejectedError> {
	const { type } = event
	const data = event.data.object
	if (CUSTOMER_EVENTS.has(type)) {
		const { id } = yield* decodeAs(ObjectId, data, type)
		const customer = yield* current(get(`/customers/${encodeURIComponent(id)}`, [], StripeCustomer))
		if (Option.isNone(customer)) return []
		return customer.value.deleted === true
			? [accountDeletedOp(id, observedAt)]
			: customerOps(customer.value, config, observedAt)
	}
	if (SUBSCRIPTION_EVENTS.has(type)) {
		const { id } = yield* decodeAs(ObjectId, data, type)
		const subscription = yield* current(
			get(`/subscriptions/${encodeURIComponent(id)}`, subscriptionExpands(""), StripeSubscription),
		)
		return Option.isNone(subscription) ? [] : yield* subscriptionOps(get, [subscription.value])
	}
	if (INVOICE_EVENTS.has(type)) {
		const { id } = yield* decodeAs(ObjectId, data, type)
		const invoice = yield* current(get(`/invoices/${encodeURIComponent(id)}`, [], StripeInvoice))
		if (Option.isNone(invoice)) return []
		const op = invoiceOp(invoice.value, {
			paymentFailed: type === "invoice.payment_failed" || type === "invoice.payment_action_required",
		})
		return op === null ? [] : [op]
	}
	if (PAYMENT_METHOD_EVENTS.has(type)) {
		const method = yield* decodeAs(StripePaymentMethod, data, type)
		// A detached method has no customer left; the event's previous attributes name it.
		const customerId =
			idOf(method.customer) ??
			Option.getOrUndefined(decodePreviousCustomer(event.data.previous_attributes))?.customer ??
			null
		if (customerId === null) return []
		const page = yield* current(
			get(
				"/subscriptions",
				[
					["customer", customerId],
					["status", "all"],
					["limit", "100"],
					...subscriptionExpands("data."),
				],
				StripeSubscriptionsPage,
			),
		)
		return Option.isNone(page) ? [] : yield* subscriptionOps(get, page.value.data)
	}
	return []
})

/** A read a later attempt can get through: unreachable, timed out, rate limited, or a 5xx. */
const isTransient = (error: CustomerProviderError): boolean =>
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
	return yield* opsOfEvent(input.get, event, input.config, new Date(nowMs).toISOString()).pipe(
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
