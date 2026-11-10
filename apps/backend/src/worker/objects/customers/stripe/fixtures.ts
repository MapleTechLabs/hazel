/**
 * Stripe payloads as Stripe actually sends them, trimmed to the fields Hazel reads plus a few it
 * ignores (so the loose schemas are exercised against real noise). Shapes follow the API reference
 * for `2025-08-27.basil` — the period on the subscription's items, the invoice's subscription under
 * `parent.subscription_details` — and the data is modelled on Maple, whose Stripe customers are
 * created by Autumn and carry the Autumn customer id (which is the Clerk organization id) in their
 * metadata.
 *
 * Timestamps are Unix seconds, as Stripe sends them.
 */

export const SEC = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000)

export const ACCOUNT = {
	id: "acct_1Hazel00000000000",
	object: "account",
	country: "DE",
	email: "billing@hazel.chat",
	business_profile: { name: "Hazel", url: "https://hazel.chat" },
	settings: { dashboard: { display_name: "Hazel Production", timezone: "Europe/Berlin" } },
}

export const ORG_ACME = "org_2acme000000000000000000"
export const ORG_GLOBEX = "org_2globex00000000000000000"

/** Autumn-managed: the Clerk org id arrives under Autumn's own metadata key, not Hazel's default. */
export const CUSTOMER_ACME = {
	id: "cus_2acme0000000001",
	object: "customer",
	name: "Acme Analytics",
	email: "billing@acme.com",
	description: "Acme Analytics (org_2acme000000000000000000)",
	currency: "usd",
	delinquent: false,
	created: SEC("2026-01-14T09:20:00.000Z"),
	livemode: true,
	metadata: { autumn_id: ORG_ACME, env: "production" },
	invoice_settings: { default_payment_method: "pm_2acme0000000001" },
}

/** The configured metadata key (`clerk_org_id`), no email: the sparse end of the shape. */
export const CUSTOMER_GLOBEX = {
	id: "cus_2globex000000001",
	object: "customer",
	name: null,
	email: null,
	currency: "eur",
	created: SEC("2026-09-30T11:30:00.000Z"),
	livemode: true,
	metadata: { clerk_org_id: ORG_GLOBEX },
}

/** A personal signup: no shared id, and a free-mail domain that must not match a company. */
export const CUSTOMER_PERSONAL = {
	id: "cus_2personal000001",
	object: "customer",
	name: "Grace Hopper",
	email: "grace.hopper@gmail.com",
	created: SEC("2026-10-05T08:00:00.000Z"),
	livemode: true,
	metadata: {},
}

export const PRODUCT_PRO = { id: "prod_2pro00000001", object: "product", name: "Pro", active: true }
export const PRODUCT_SEATS = {
	id: "prod_2seats0000001",
	object: "product",
	name: "Extra seats",
	active: true,
}
export const PRODUCT_EVENTS = {
	id: "prod_2events000001",
	object: "product",
	name: "Events",
	active: true,
}

const price = (overrides: Record<string, unknown>) => ({
	id: "price_2pro000000001",
	object: "price",
	active: true,
	billing_scheme: "per_unit",
	currency: "usd",
	nickname: null,
	lookup_key: null,
	product: PRODUCT_PRO.id,
	tax_behavior: "unspecified",
	type: "recurring",
	unit_amount: 10_000,
	unit_amount_decimal: "10000",
	recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
	...overrides,
})

const item = (overrides: Record<string, unknown>) => ({
	id: "si_2acme00000001",
	object: "subscription_item",
	current_period_end: SEC("2026-12-01T09:20:00.000Z"),
	quantity: 1,
	price: price({}),
	...overrides,
})

/** Yearly, 12 seats: 1 200.00 USD a year × 12 → 120 000 minor a month. */
export const SUB_ACME = {
	id: "sub_2acme00000001",
	object: "subscription",
	customer: CUSTOMER_ACME.id,
	status: "active",
	currency: "usd",
	cancel_at_period_end: false,
	canceled_at: null,
	cancellation_details: { comment: null, feedback: null, reason: null },
	created: SEC("2026-01-14T09:25:00.000Z"),
	start_date: SEC("2026-01-14T09:25:00.000Z"),
	trial_end: null,
	livemode: true,
	metadata: {},
	default_payment_method: "pm_2acme0000000001",
	discounts: [],
	items: {
		object: "list",
		has_more: false,
		data: [
			item({
				id: "si_2acme00000001",
				quantity: 12,
				price: price({
					id: "price_2pro_year0001",
					unit_amount: 120_000,
					unit_amount_decimal: "120000",
					recurring: { interval: "year", interval_count: 1, usage_type: "licensed" },
				}),
			}),
		],
	},
}

/** Trialing, three monthly seats of 49.00 EUR, plus a metered price that states no amount. */
export const SUB_GLOBEX = {
	id: "sub_2globex000001",
	object: "subscription",
	customer: CUSTOMER_GLOBEX.id,
	status: "trialing",
	currency: "eur",
	cancel_at_period_end: false,
	canceled_at: null,
	created: SEC("2026-09-30T11:35:00.000Z"),
	start_date: SEC("2026-09-30T11:35:00.000Z"),
	trial_end: SEC("2026-11-14T11:35:00.000Z"),
	livemode: true,
	default_payment_method: null,
	discounts: [],
	items: {
		object: "list",
		has_more: false,
		data: [
			item({
				id: "si_2globex000001",
				quantity: 3,
				price: price({
					id: "price_2seats_month1",
					currency: "eur",
					product: PRODUCT_SEATS.id,
					unit_amount: 4_900,
					unit_amount_decimal: "4900",
				}),
			}),
			item({
				id: "si_2globex000002",
				quantity: null,
				price: price({
					id: "price_2events_meter",
					currency: "eur",
					product: PRODUCT_EVENTS.id,
					unit_amount: null,
					unit_amount_decimal: null,
					billing_scheme: "tiered",
					tiers_mode: "graduated",
					recurring: { interval: "month", interval_count: 1, usage_type: "metered" },
				}),
			}),
		],
	},
}

/** Canceled, so compute can recognise the churn, and the reason the customer gave. */
export const SUB_PERSONAL_CANCELED = {
	id: "sub_2personal0001",
	object: "subscription",
	customer: CUSTOMER_PERSONAL.id,
	status: "canceled",
	currency: "usd",
	cancel_at_period_end: false,
	canceled_at: SEC("2026-11-01T10:00:00.000Z"),
	cancellation_details: { comment: null, feedback: "too_expensive", reason: "cancellation_requested" },
	created: SEC("2026-10-05T08:05:00.000Z"),
	start_date: SEC("2026-10-05T08:05:00.000Z"),
	trial_end: null,
	livemode: true,
	default_payment_method: null,
	discounts: [],
	items: { object: "list", has_more: false, data: [item({ id: "si_2personal0001", quantity: 1 })] },
}

export const PAYMENT_METHOD_ACME = {
	id: "pm_2acme0000000001",
	object: "payment_method",
	type: "card",
	customer: CUSTOMER_ACME.id,
	livemode: true,
	card: {
		brand: "visa",
		last4: "4242",
		exp_month: 4,
		exp_year: 2030,
		funding: "credit",
		country: "US",
	},
}

/** 20% off, embedded as `coupon` the way `2025-08-27.basil` sends it. */
export const DISCOUNT_20_PERCENT = {
	id: "di_2acme00000001",
	object: "discount",
	coupon: {
		id: "LAUNCH20",
		object: "coupon",
		name: "Launch 20%",
		percent_off: 20,
		amount_off: null,
		currency: null,
		duration: "forever",
		valid: true,
	},
}

export const INVOICE_ACME_PAID = {
	id: "in_2acme00000001",
	object: "invoice",
	number: "HAZEL-0001",
	status: "paid",
	customer: CUSTOMER_ACME.id,
	// `2025-03-31.basil` and later: the subscription lives under `parent`.
	parent: { type: "subscription_details", subscription_details: { subscription: SUB_ACME.id } },
	amount_due: 120_000,
	amount_paid: 120_000,
	currency: "usd",
	created: SEC("2026-11-01T09:25:00.000Z"),
	due_date: null,
	attempt_count: 1,
	next_payment_attempt: null,
	hosted_invoice_url: "https://invoice.stripe.com/i/acct_1Hazel00000000000/live_YWNbe",
	status_transitions: {
		finalized_at: SEC("2026-11-01T09:26:00.000Z"),
		paid_at: SEC("2026-11-01T09:27:00.000Z"),
		voided_at: null,
		marked_uncollectible_at: null,
	},
	livemode: true,
}

/** Open, overdue, one attempt made and the next scheduled: what a payment_failed looks like. */
export const INVOICE_GLOBEX_OPEN = {
	id: "in_2globex000001",
	object: "invoice",
	number: "HAZEL-0002",
	status: "open",
	customer: CUSTOMER_GLOBEX.id,
	parent: { type: "subscription_details", subscription_details: { subscription: SUB_GLOBEX.id } },
	amount_due: 14_700,
	amount_paid: 0,
	currency: "eur",
	created: SEC("2026-11-05T11:35:00.000Z"),
	due_date: SEC("2026-11-08T11:35:00.000Z"),
	attempt_count: 1,
	next_payment_attempt: SEC("2026-11-12T11:35:00.000Z"),
	hosted_invoice_url: "https://invoice.stripe.com/i/acct_1Hazel00000000000/live_R3ue",
	status_transitions: {
		finalized_at: SEC("2026-11-05T11:36:00.000Z"),
		paid_at: null,
		voided_at: null,
		marked_uncollectible_at: null,
	},
	livemode: true,
}

/** An older API version's invoice: the subscription flat, no `parent`. */
export const INVOICE_ACME_OLD_VERSION = {
	id: "in_2legacy000001",
	object: "invoice",
	number: "HAZEL-0003",
	status: "draft",
	customer: CUSTOMER_ACME.id,
	subscription: SUB_ACME.id,
	amount_due: 10_000,
	amount_paid: 0,
	currency: "usd",
	created: SEC("2026-11-09T09:00:00.000Z"),
	attempt_count: 0,
	livemode: true,
}

/** One delivery's body, as Stripe posts it. */
export const event = (type: string, object: unknown, overrides: Record<string, unknown> = {}): string =>
	JSON.stringify({
		id: "evt_2hazel00000001",
		object: "event",
		api_version: "2025-08-27.basil",
		created: SEC("2026-11-10T12:00:00.000Z"),
		livemode: true,
		pending_webhooks: 1,
		request: { id: null, idempotency_key: null },
		type,
		data: { object },
		...overrides,
	})
