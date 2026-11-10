/**
 * One Stripe webhook delivery → `IngestOp`s.
 *
 * The connection's endpoint signing secret verifies the `Stripe-Signature` header over the raw body
 * (`./signature.ts`) before anything is parsed. A bad signature, a replayed delivery (its timestamp
 * outside ±5 minutes), a payload that will not decode, or an event from another Stripe account or
 * the other mode than the key opens is refused, and the route answers 400. Stripe retries a non-2xx
 * with backoff for up to three days, so only what a retry cannot fix is refused; an event type
 * Hazel does not handle is acknowledged. Everything else is applied by ingest, which is idempotent,
 * so Stripe's retries and redeliveries are safe, and account ops carry `observedAt` so a late retry
 * cannot revive a customer deleted since.
 *
 * The events Hazel subscribes to, and what each one writes:
 *
 * | Event | Writes |
 * |---|---|
 * | `customer.created` / `customer.updated` | account (name, shared ids, domain) + billing contact |
 * | `customer.deleted` | the ref goes stale; the account is soft-deleted with no live ref left |
 * | `customer.subscription.created` | subscription → `subscription.started` |
 * | `customer.subscription.updated` | subscription → `plan_changed` / `cancel_scheduled` / `canceled` |
 * | `customer.subscription.deleted` | the subscription as `canceled` → `subscription.canceled` |
 * | `customer.subscription.paused` / `resumed` / `trial_will_end` | the subscription's new state |
 * | `invoice.created` / `finalized` / `voided` / `marked_uncollectible` | the invoice's state |
 * | `invoice.paid` / `payment_succeeded` | the invoice → `invoice.paid` |
 * | `invoice.payment_failed` / `payment_action_required` | the invoice → `invoice.payment_failed` |
 * | `payment_method.attached` / `updated` / `automatically_updated` | the customer's subscriptions, for the card on file |
 *
 * A subscription's plan name is the Stripe **product**'s, which is not on a subscription payload
 * (only the product's id), so every delivery that writes a subscription costs one
 * `GET /v1/products/{id}` per distinct plan, at most {@link MAX_PRODUCT_LOOKUPS}. If that request
 * fails the delivery is still acknowledged, with the price's nickname instead, rather than Stripe
 * retrying it for days. A `payment_method.*` delivery names no subscription, so it lists the
 * customer's (`GET /v1/subscriptions?customer=…`) to write the card against them.
 *
 * `invoice.upcoming` is not handled: Stripe's preview has no invoice id, and nothing in Hazel reads
 * an `upcoming` invoice yet.
 */
import type { ConnectionConfig, IngestOp, IsoTimestamp } from "@hazel/domain/customers"
import { Clock, Effect, Redacted, Schema } from "effect"
import {
	type CustomerWebhookRejectedError as RejectedError,
	CustomerWebhookRejectedError,
} from "../provider-errors"
import { issueSummary, type StripeGet } from "./http"
import { accountDeletedOp, customerOps, invoiceOp, primaryProductIdOf, subscriptionOp } from "./map"
import { verifyStripeSignature } from "./signature"
import {
	idOf,
	isoOf,
	StripeCustomer,
	StripeEvent,
	StripeInvoice,
	StripePaymentMethod,
	StripeProduct,
	StripeSubscription,
	StripeSubscriptionsPage,
} from "./wire"

/** Product names fetched for one delivery; a subscription has one plan, a customer rarely many. */
export const MAX_PRODUCT_LOOKUPS = 5

/** Refuse a delivery: logged with the reason (never the payload), answered 400 with `message`. */
const reject = (reason: string, message: string, detail: Record<string, unknown> = {}) =>
	Effect.logWarning("Stripe webhook refused", { reason, ...detail }).pipe(
		Effect.andThen(Effect.annotateCurrentSpan("stripe.webhook.rejected", reason)),
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

/** One product's name; `None` when Stripe could not be asked. Never fails the delivery. */
const productNames = (get: StripeGet, productIds: ReadonlyArray<string>) =>
	Effect.reduce(
		productIds.slice(0, MAX_PRODUCT_LOOKUPS),
		(): Map<string, string> => new Map(),
		(names, productId) =>
			get(`/products/${productId}`, [], StripeProduct).pipe(
				Effect.map((product) =>
					product.name == null || product.name.trim() === ""
						? names
						: names.set(product.id, product.name.trim()),
				),
				Effect.catchTag("CustomerProviderError", (error) =>
					Effect.logWarning("Stripe product could not be read", {
						code: error.code,
						message: error.message,
					}).pipe(Effect.as(names)),
				),
			),
	)

/** Subscription ops with their plan names resolved, the one path every subscription write takes. */
const subscriptionOps = Effect.fn("Stripe.subscriptionOps")(function* (
	get: StripeGet,
	subscriptions: ReadonlyArray<StripeSubscription>,
) {
	const productIds = [
		...new Set(
			subscriptions.flatMap((subscription) => {
				const productId = primaryProductIdOf(subscription)
				return productId === null ? [] : [productId]
			}),
		),
	]
	const names = yield* productNames(get, productIds)
	return subscriptions.flatMap((subscription): Array<IngestOp> => {
		const op = subscriptionOp(subscription, names)
		return op === null ? [] : [op]
	})
})

/** The customer's subscriptions, for a delivery that names a card but no subscription. */
const subscriptionsOfCustomer = (get: StripeGet, customerId: string) =>
	get(
		"/subscriptions",
		[
			["customer", customerId],
			["status", "all"],
			["limit", "100"],
			["expand[]", "data.default_payment_method"],
			["expand[]", "data.discounts"],
		],
		StripeSubscriptionsPage,
	).pipe(
		Effect.map((page) => page.data),
		Effect.catchTag("CustomerProviderError", (error) =>
			Effect.logWarning("Stripe customer's subscriptions could not be listed", {
				code: error.code,
				message: error.message,
			}).pipe(Effect.as([] as ReadonlyArray<StripeSubscription>)),
		),
	)

/** A verified delivery's ops. `type` drives everything; unknown types are acknowledged as no-ops. */
export const opsOfEvent = Effect.fn("Stripe.opsOfEvent")(function* (
	get: StripeGet,
	event: StripeEvent,
	config: ConnectionConfig,
): Effect.fn.Return<ReadonlyArray<IngestOp>, RejectedError> {
	const { type } = event
	const data = event.data.object
	/** Stripe customers carry no `updated`, so the event's own time orders them. */
	const observedAt: IsoTimestamp | undefined =
		isoOf(event.created) ?? new Date(yield* Clock.currentTimeMillis).toISOString()
	switch (type) {
		case "customer.created":
		case "customer.updated": {
			const customer = yield* decodeAs(StripeCustomer, data, type)
			return customerOps(customer, config, observedAt)
		}
		case "customer.deleted": {
			const customer = yield* decodeAs(StripeCustomer, data, type)
			return [accountDeletedOp(customer.id)]
		}
		case "customer.subscription.created":
		case "customer.subscription.updated":
		case "customer.subscription.deleted":
		case "customer.subscription.paused":
		case "customer.subscription.resumed":
		case "customer.subscription.trial_will_end": {
			const subscription = yield* decodeAs(StripeSubscription, data, type)
			return yield* subscriptionOps(get, [subscription])
		}
		case "invoice.created":
		case "invoice.finalized":
		case "invoice.paid":
		case "invoice.payment_succeeded":
		case "invoice.payment_failed":
		case "invoice.payment_action_required":
		case "invoice.voided":
		case "invoice.marked_uncollectible": {
			const invoice = yield* decodeAs(StripeInvoice, data, type)
			const op = invoiceOp(invoice, {
				// Stripe keeps the decline message on the payment intent, which Hazel does not read:
				// without a reason here ingest cannot tell a first failed attempt from an open invoice.
				paymentFailed:
					type === "invoice.payment_failed" || type === "invoice.payment_action_required",
			})
			return op === null ? [] : [op]
		}
		case "payment_method.attached":
		case "payment_method.updated":
		case "payment_method.automatically_updated": {
			const method = yield* decodeAs(StripePaymentMethod, data, type)
			const customerId = idOf(method.customer)
			if (customerId === null) return []
			return yield* subscriptionOps(get, yield* subscriptionsOfCustomer(get, customerId))
		}
		default:
			return []
	}
})

/**
 * Verify the delivery, then map it. Core refuses a connection with no signing secret before this.
 *
 * `accountId` is the Stripe account the key opens (null when the key may not read it) and
 * `livemode` the mode it is for (null for a key whose prefix does not say): an event from another
 * connected account, or from the other mode, is refused, so a test-mode endpoint's secret next to a
 * live key cannot write test data into a production connection.
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
	yield* verifyStripeSignature({
		secret: Redacted.value(input.webhookSecret),
		headers: input.headers,
		body: input.body,
		nowMs: yield* Clock.currentTimeMillis,
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
	if (input.accountId !== null && account !== null && account !== input.accountId) {
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
	return yield* opsOfEvent(input.get, event, input.config)
})
