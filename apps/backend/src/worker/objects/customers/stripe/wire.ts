/**
 * The Stripe API objects and webhook payloads Hazel reads, as loose schemas.
 *
 * Verified against Stripe's API reference for `2025-08-27.basil` (the version every request pins,
 * {@link STRIPE_API_VERSION}): `/v1/account`, `/v1/customers`, `/v1/products`, `/v1/subscriptions`,
 * `/v1/invoices`, `/v1/payment_methods`.
 *
 * Every field Hazel does not need is left out, and nearly everything is optional and nullable: a
 * webhook endpoint delivers events in *its own* pinned version, which is rarely the one Hazel asks
 * the API for, and a decode failure here would 400 a delivery we could otherwise have handled. The
 * fields that moved between versions are read from both places:
 *
 * - `subscription.current_period_end` moved onto the subscription's **items** in `2025-03-31.basil`.
 * - `invoice.subscription` became `invoice.parent.subscription_details.subscription` in the same
 *   version.
 * - A discount embeds its `coupon` up to `2025-08-27.basil` and carries it under `source.coupon`
 *   from `2025-09-30.clover`.
 *
 * Timestamps are Unix **seconds** (Clerk's are milliseconds; do not copy that code).
 */
import type { IsoTimestamp } from "@hazel/domain/customers"
import { Schema } from "effect"

/**
 * The API version every request pins, so a Dashboard upgrade cannot change the wire shape under
 * Hazel. Webhook deliveries come in whatever version their endpoint was created with, which is why
 * the schemas below tolerate both the old and the new shape of what moved.
 */
export const STRIPE_API_VERSION = "2025-08-27.basil"

const Nullable = <S extends Schema.Top>(schema: S) => Schema.optionalKey(Schema.NullOr(schema))

/** Stripe metadata is `string -> string`, but never trust a map's values. */
const Metadata = Nullable(Schema.Record(Schema.String, Schema.Unknown))

/** `GET /v1/account`: the Stripe account the key opens (the connection's `externalAccountId`). */
export const StripeAccount = Schema.Struct({
	id: Schema.String,
	email: Nullable(Schema.String),
	business_profile: Nullable(Schema.Struct({ name: Nullable(Schema.String) })),
	settings: Nullable(
		Schema.Struct({
			dashboard: Nullable(Schema.Struct({ display_name: Nullable(Schema.String) })),
		}),
	),
})

export const StripeCustomer = Schema.Struct({
	id: Schema.String,
	name: Nullable(Schema.String),
	email: Nullable(Schema.String),
	description: Nullable(Schema.String),
	currency: Nullable(Schema.String),
	delinquent: Nullable(Schema.Boolean),
	/** Unix seconds. */
	created: Nullable(Schema.Number),
	metadata: Metadata,
	/** Only on a `customer.deleted` payload and in an expanded, deleted reference. */
	deleted: Nullable(Schema.Boolean),
	livemode: Nullable(Schema.Boolean),
})
export type StripeCustomer = typeof StripeCustomer.Type

export const StripeProduct = Schema.Struct({
	id: Schema.String,
	name: Nullable(Schema.String),
	active: Nullable(Schema.Boolean),
})
export type StripeProduct = typeof StripeProduct.Type

/**
 * A `price`, or the legacy `plan` a subscription item still carries (same fields, with the amount
 * under `amount` instead of `unit_amount`).
 */
export const StripePrice = Schema.Struct({
	id: Nullable(Schema.String),
	nickname: Nullable(Schema.String),
	lookup_key: Nullable(Schema.String),
	currency: Nullable(Schema.String),
	/** Minor units of the currency (and already the unit for zero-decimal ones like JPY). */
	unit_amount: Nullable(Schema.Number),
	/** Set instead of `unit_amount` for sub-cent prices; a decimal string of minor units. */
	unit_amount_decimal: Nullable(Schema.String),
	/** `amount` on a legacy `plan`. */
	amount: Nullable(Schema.Number),
	amount_decimal: Nullable(Schema.String),
	/** `per_unit` or `tiered`; a tiered price's amount is not on the price. */
	billing_scheme: Nullable(Schema.String),
	/** The product id; expanding it on a list is past Stripe's four-level limit, so it stays an id. */
	product: Nullable(Schema.String),
	recurring: Nullable(
		Schema.Struct({
			interval: Nullable(Schema.String),
			interval_count: Nullable(Schema.Number),
			/** `metered` prices bill by usage: their monthly amount is not knowable here. */
			usage_type: Nullable(Schema.String),
		}),
	),
	/** A legacy `plan` carries the interval flat, not under `recurring`. */
	interval: Nullable(Schema.String),
	interval_count: Nullable(Schema.Number),
	usage_type: Nullable(Schema.String),
})
export type StripePrice = typeof StripePrice.Type

export const StripeSubscriptionItem = Schema.Struct({
	id: Nullable(Schema.String),
	quantity: Nullable(Schema.Number),
	/** Where the period moved in `2025-03-31.basil`. */
	current_period_end: Nullable(Schema.Number),
	price: Schema.optionalKey(StripePrice),
	plan: Schema.optionalKey(StripePrice),
})
export type StripeSubscriptionItem = typeof StripeSubscriptionItem.Type

export const StripeCoupon = Schema.Struct({
	id: Nullable(Schema.String),
	name: Nullable(Schema.String),
	percent_off: Nullable(Schema.Number),
	/** Minor units, in `currency`. */
	amount_off: Nullable(Schema.Number),
	currency: Nullable(Schema.String),
	/** `forever`, `once` or `repeating`. */
	duration: Nullable(Schema.String),
})
export type StripeCoupon = typeof StripeCoupon.Type

export const StripeDiscount = Schema.Struct({
	id: Nullable(Schema.String),
	coupon: Nullable(StripeCoupon),
	/** Where the coupon moved in `2025-09-30.clover`. */
	source: Nullable(Schema.Struct({ coupon: Nullable(StripeCoupon) })),
})
export type StripeDiscount = typeof StripeDiscount.Type

export const StripePaymentMethod = Schema.Struct({
	id: Nullable(Schema.String),
	type: Nullable(Schema.String),
	customer: Nullable(Schema.String),
	card: Nullable(
		Schema.Struct({
			brand: Nullable(Schema.String),
			last4: Nullable(Schema.String),
			exp_month: Nullable(Schema.Number),
			exp_year: Nullable(Schema.Number),
		}),
	),
	livemode: Nullable(Schema.Boolean),
})
export type StripePaymentMethod = typeof StripePaymentMethod.Type

/** An id, or the object it expands into: `customer`, `default_payment_method`, `discounts[]`. */
const Expandable = <S extends Schema.Top>(schema: S) =>
	Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, schema])))

export const StripeSubscription = Schema.Struct({
	id: Schema.String,
	customer: Expandable(StripeCustomer),
	status: Nullable(Schema.String),
	currency: Nullable(Schema.String),
	items: Nullable(Schema.Struct({ data: Schema.optionalKey(Schema.Array(StripeSubscriptionItem)) })),
	/** Up to `2025-03-31.basil`; after it the period is per item. */
	current_period_end: Nullable(Schema.Number),
	trial_end: Nullable(Schema.Number),
	start_date: Nullable(Schema.Number),
	created: Nullable(Schema.Number),
	canceled_at: Nullable(Schema.Number),
	cancel_at_period_end: Nullable(Schema.Boolean),
	cancellation_details: Nullable(
		Schema.Struct({
			reason: Nullable(Schema.String),
			feedback: Nullable(Schema.String),
			comment: Nullable(Schema.String),
		}),
	),
	default_payment_method: Expandable(StripePaymentMethod),
	discounts: Nullable(Schema.Array(Schema.Union([Schema.String, StripeDiscount]))),
	metadata: Metadata,
	livemode: Nullable(Schema.Boolean),
})
export type StripeSubscription = typeof StripeSubscription.Type

export const StripeInvoice = Schema.Struct({
	/** Null on an upcoming-invoice preview, which Hazel skips. */
	id: Nullable(Schema.String),
	number: Nullable(Schema.String),
	status: Nullable(Schema.String),
	customer: Expandable(StripeCustomer),
	/** Up to `2025-03-31.basil`; after it under `parent.subscription_details`. */
	subscription: Expandable(StripeSubscription),
	parent: Nullable(
		Schema.Struct({
			subscription_details: Nullable(Schema.Struct({ subscription: Expandable(StripeSubscription) })),
		}),
	),
	amount_due: Nullable(Schema.Number),
	amount_paid: Nullable(Schema.Number),
	currency: Nullable(Schema.String),
	created: Nullable(Schema.Number),
	due_date: Nullable(Schema.Number),
	attempt_count: Nullable(Schema.Number),
	next_payment_attempt: Nullable(Schema.Number),
	hosted_invoice_url: Nullable(Schema.String),
	status_transitions: Nullable(
		Schema.Struct({
			finalized_at: Nullable(Schema.Number),
			paid_at: Nullable(Schema.Number),
			voided_at: Nullable(Schema.Number),
			marked_uncollectible_at: Nullable(Schema.Number),
		}),
	),
	last_finalization_error: Nullable(
		Schema.Struct({ message: Nullable(Schema.String), code: Nullable(Schema.String) }),
	),
	livemode: Nullable(Schema.Boolean),
})
export type StripeInvoice = typeof StripeInvoice.Type

/** `{ object: "list", data, has_more }`, the shape of every list endpoint Hazel pages through. */
export const StripeList = <S extends Schema.Top>(item: S) =>
	Schema.Struct({ data: Schema.Array(item), has_more: Nullable(Schema.Boolean) })

export const StripeCustomersPage = StripeList(StripeCustomer)
export const StripeProductsPage = StripeList(StripeProduct)
export const StripeSubscriptionsPage = StripeList(StripeSubscription)
export const StripeInvoicesPage = StripeList(StripeInvoice)

/**
 * Every delivery: `{ id, type, data: { object }, created, livemode, account }`. `account` is set
 * only on an event from a connected account; `livemode` says which mode it happened in.
 */
export const StripeEvent = Schema.Struct({
	id: Schema.String,
	type: Schema.String,
	/** Unix seconds: orders the event's ops against a deletion. */
	created: Schema.Number,
	livemode: Nullable(Schema.Boolean),
	/** The connected account the event belongs to (Connect platforms only). */
	account: Nullable(Schema.String),
	api_version: Nullable(Schema.String),
	data: Schema.Struct({ object: Schema.Unknown }),
})
export type StripeEvent = typeof StripeEvent.Type

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** 10000-01-01 in seconds: past it `toISOString` widens the year, which is no `IsoTimestamp`. */
const MAX_SECONDS = 253_402_300_800

/**
 * An ISO instant from a Stripe Unix-**second** timestamp; null when Stripe sent none, or one
 * outside 1970–9999, so every instant passes ingest's `IsoTimestamp` check.
 */
export const isoOf = (seconds: number | null | undefined): IsoTimestamp | null =>
	seconds === null || seconds === undefined || !(seconds >= 0 && seconds < MAX_SECONDS)
		? null
		: new Date(seconds * 1000).toISOString()

/** The id of an expandable field, whether Stripe sent the id or the object. */
export const idOf = (value: string | { readonly id?: string | null } | null | undefined): string | null =>
	value === null || value === undefined ? null : typeof value === "string" ? value : (value.id ?? null)

/** The object of an expandable field, when it was expanded (a bare id gives nothing). */
export const objectOf = <A extends object>(value: string | A | null | undefined): A | null =>
	value === null || value === undefined || typeof value === "string" ? null : value

/** Stripe metadata as strings: a value that is not one (never seen, but a map) is dropped. */
export const metadataOf = (
	metadata: Readonly<Record<string, unknown>> | null | undefined,
): ReadonlyArray<readonly [string, string]> =>
	Object.entries(metadata ?? {}).flatMap(([key, value]) =>
		typeof value === "string" && value.trim() !== "" ? [[key, value.trim()] as const] : [],
	)

/** Clerk organization ids are `org_` + an id; nothing else in Stripe metadata looks like one. */
const CLERK_ORG_ID = /^org_[A-Za-z0-9]{6,}$/

export const isClerkOrgId = (value: string): boolean => CLERK_ORG_ID.test(value)

/** The subscription a Stripe invoice belongs to, wherever this API version keeps it. */
export const invoiceSubscriptionIdOf = (invoice: StripeInvoice): string | null =>
	idOf(invoice.subscription) ?? idOf(invoice.parent?.subscription_details?.subscription)

/** The coupons applied to a subscription; an unexpanded discount (a bare id) says nothing. */
export const couponsOf = (subscription: StripeSubscription): ReadonlyArray<StripeCoupon> =>
	(subscription.discounts ?? []).flatMap((discount) => {
		const expanded = objectOf(discount)
		if (expanded === null) return []
		const coupon = expanded.coupon ?? expanded.source?.coupon ?? null
		return coupon === null ? [] : [coupon]
	})

/** A subscription's price, from `price` or the legacy `plan`. */
export const priceOf = (item: StripeSubscriptionItem): StripePrice | null => item.price ?? item.plan ?? null

/** The period end, from the subscription or (newer versions) the latest of its items. */
export const periodEndOf = (subscription: StripeSubscription): number | null => {
	if (subscription.current_period_end != null) return subscription.current_period_end
	const ends = (subscription.items?.data ?? []).flatMap((item) =>
		item.current_period_end == null ? [] : [item.current_period_end],
	)
	return ends.length === 0 ? null : Math.max(...ends)
}

const DASHBOARD = "https://dashboard.stripe.com"

/** Test-mode objects live under `/test` in the Dashboard; live ones at the root. */
const dashboard = (livemode: boolean | null | undefined, path: string): string =>
	livemode === false ? `${DASHBOARD}/test/${path}` : `${DASHBOARD}/${path}`

export const customerUrlOf = (id: string, livemode: boolean | null | undefined): string =>
	dashboard(livemode, `customers/${id}`)
