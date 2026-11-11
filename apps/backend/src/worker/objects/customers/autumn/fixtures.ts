/**
 * Autumn payloads as Autumn actually sends them at `x-api-version: 2.5.0`, trimmed to the fields
 * Hazel reads plus a few it ignores (so the loose schemas are exercised against real noise). Shapes
 * follow Autumn's OpenAPI document and the handlers behind it (`useautumn/autumn`): plan amounts in
 * major units, `balances` keyed by feature id, a customer listing only its live plans, and
 * `subscriptions.list` as the one place an `expired` row appears.
 *
 * The data is modelled on Maple, where the Autumn customer id *is* the Clerk organization id.
 *
 * Timestamps are Unix milliseconds, as Autumn sends them.
 */

export const MS = (iso: string): number => new Date(iso).getTime()

/** The Clerk organizations the identity source created; Autumn keys its customers by them. */
export const ORG_ACME = "org_2acme000000000000000000"
export const ORG_GLOBEX = "org_2globex00000000000000000"

export const ORG_ME = {
	id: "org_autumn_hazel00000",
	name: "Hazel",
	slug: "hazel",
	env: "live",
	is_sandbox: false,
	created_by: null,
}

export const ORGANIZATION = {
	id: ORG_ME.id,
	name: "Hazel",
	slug: "hazel",
	default_currency: "usd",
	stripe_connection: "secret_key",
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

export const FEATURE_MESSAGES = {
	id: "messages",
	name: "Messages",
	type: "metered",
	consumable: true,
	event_names: ["message_sent"],
}

/** A seat-style feature: metered but not consumable (usage persists across periods). */
export const FEATURE_SEATS = { id: "seats", name: "Seats", type: "metered", consumable: false }

/** A flag: Autumn keeps it under `flags`, never `balances`, and it is no metric. */
export const FEATURE_SSO = { id: "sso", name: "SSO", type: "boolean", consumable: false }

export const FEATURES = [FEATURE_MESSAGES, FEATURE_SEATS, FEATURE_SSO]

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/** $99 a month, 10 000 messages included and $0.002 per message after that. */
export const PLAN_PRO = {
	id: "pro",
	name: "Pro",
	version: 2,
	version_slug: "v2",
	active: true,
	add_on: false,
	auto_enable: false,
	price: { amount: 99, interval: "month", interval_count: 1 },
	items: [
		{
			feature_id: "messages",
			included: 10_000,
			unlimited: false,
			price: {
				amount: 0.002,
				interval: "month",
				interval_count: 1,
				billing_units: 1,
				billing_method: "usage_based",
				max_purchase: null,
			},
		},
		{ feature_id: "seats", included: 25, unlimited: false, price: null },
	],
}

/** The version this plan's grandfathered customers are still on: archived, so `active` is false. */
export const PLAN_PRO_V1 = {
	...PLAN_PRO,
	version: 1,
	active: false,
	price: { amount: 79, interval: "month" },
}

/** $12 000 a year: a twelfth of it is the MRR. */
export const PLAN_ENTERPRISE = {
	id: "enterprise",
	name: "Enterprise",
	version: 1,
	active: true,
	add_on: false,
	auto_enable: false,
	price: { amount: 12_000, interval: "year", interval_count: 1 },
	items: [{ feature_id: "messages", included: 1_000_000, unlimited: false, price: null }],
}

/** Autumn's free tier: no base price at all, so no MRR. */
export const PLAN_FREE = {
	id: "free",
	name: "Free",
	version: 1,
	active: true,
	add_on: false,
	auto_enable: true,
	price: null,
	items: [{ feature_id: "messages", included: 100, unlimited: false, price: null }],
}

export const PLANS = [PLAN_PRO, PLAN_PRO_V1, PLAN_ENTERPRISE, PLAN_FREE]

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const SUB_ACME = {
	id: "cus_prod_2acme0000001",
	plan_id: "pro",
	status: "active",
	past_due: false,
	add_on: false,
	auto_enable: false,
	started_at: MS("2026-01-14T09:20:00.000Z"),
	canceled_at: null,
	expires_at: null,
	trial_ends_at: null,
	current_period_start: MS("2026-11-01T09:20:00.000Z"),
	current_period_end: MS("2026-12-01T09:20:00.000Z"),
	quantity: 1,
	scope: "customer",
	customer_id: ORG_ACME,
	entity_id: null,
	created_at: MS("2026-01-14T09:20:00.000Z"),
}

/** Trialing: an `active` plan whose `trial_ends_at` Autumn has not cleared yet. */
export const SUB_GLOBEX_TRIAL = {
	id: "cus_prod_2globex000001",
	plan_id: "enterprise",
	status: "active",
	past_due: false,
	add_on: false,
	auto_enable: false,
	started_at: MS("2026-11-05T11:30:00.000Z"),
	canceled_at: null,
	expires_at: null,
	trial_ends_at: MS("2026-11-19T11:30:00.000Z"),
	current_period_start: MS("2026-11-05T11:30:00.000Z"),
	current_period_end: MS("2026-11-19T11:30:00.000Z"),
	quantity: 3,
	scope: "customer",
	customer_id: ORG_GLOBEX,
	entity_id: null,
	created_at: MS("2026-11-05T11:30:00.000Z"),
}

/** Cancelled but still running to the period's end: `canceled_at` set, status still `active`. */
export const SUB_ACME_CANCELING = {
	...SUB_ACME,
	canceled_at: MS("2026-11-08T16:00:00.000Z"),
	expires_at: MS("2026-12-01T09:20:00.000Z"),
}

/** Overdue: Autumn reports it `active` with `past_due` beside it. */
export const SUB_ACME_PAST_DUE = { ...SUB_ACME, past_due: true }

/** Ended. Only `subscriptions.list` reports one; a customer never lists it. */
export const SUB_ACME_EXPIRED = {
	...SUB_ACME,
	id: "cus_prod_2acme0000000",
	plan_id: "free",
	status: "expired",
	started_at: MS("2025-11-01T09:00:00.000Z"),
	canceled_at: MS("2026-01-14T09:20:00.000Z"),
	expires_at: MS("2026-01-14T09:20:00.000Z"),
	current_period_start: null,
	current_period_end: null,
}

/** A plan queued to start: it bills nothing yet, so Hazel records nothing. */
export const SUB_ACME_SCHEDULED = {
	...SUB_ACME,
	id: "cus_prod_2acme0000002",
	plan_id: "free",
	status: "scheduled",
	started_at: MS("2026-12-01T09:20:00.000Z"),
	current_period_start: null,
	current_period_end: null,
}

/** A sub-customer's plan: Autumn scopes it to an entity, and it is not the account's. */
export const SUB_ACME_ENTITY = {
	...SUB_ACME,
	id: "cus_prod_2acme0000003",
	scope: "entity",
	entity_id: "workspace_abc",
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

const BALANCE_MESSAGES = {
	feature_id: "messages",
	feature: { id: "messages", name: "Messages", type: "metered", consumable: true },
	granted: 10_000,
	remaining: 1_800,
	usage: 8_200,
	unlimited: false,
	overage_allowed: true,
	max_purchase: null,
	next_reset_at: MS("2026-12-01T09:20:00.000Z"),
}

const BALANCE_SEATS = {
	feature_id: "seats",
	feature: { id: "seats", name: "Seats", type: "metered", consumable: false },
	granted: 25,
	remaining: 13,
	usage: 12,
	unlimited: false,
	overage_allowed: false,
	max_purchase: null,
	next_reset_at: null,
}

/** The id is the Clerk organization id: the shared id that places this customer with no setup. */
export const CUSTOMER_ACME = {
	id: ORG_ACME,
	name: "Acme Analytics",
	email: "billing@acme.com",
	created_at: MS("2026-01-14T09:20:00.000Z"),
	stripe_id: "cus_2acme0000000001",
	env: "live",
	metadata: { plan_source: "self_serve" },
	send_email_receipts: true,
	subscriptions: [SUB_ACME],
	purchases: [],
	licenses: [{ license_plan_id: "pro", parent_plan_id: "pro", granted: 25, usage: 12, paid_quantity: 0 }],
	balances: { messages: BALANCE_MESSAGES, seats: BALANCE_SEATS },
	flags: { sso: { id: "sso", plan_id: "pro" } },
}

/** Trialing, unlimited on one feature: an unlimited balance has no limit to be near. */
export const CUSTOMER_GLOBEX = {
	id: ORG_GLOBEX,
	name: null,
	email: null,
	created_at: MS("2026-11-05T11:30:00.000Z"),
	stripe_id: null,
	env: "live",
	metadata: {},
	subscriptions: [SUB_GLOBEX_TRIAL],
	licenses: [],
	balances: {
		messages: {
			feature_id: "messages",
			feature: { id: "messages", name: "Messages" },
			granted: 1_000_000,
			remaining: 999_000,
			usage: 1_000,
			unlimited: true,
			overage_allowed: false,
			max_purchase: null,
			next_reset_at: null,
		},
	},
}

/** A personal signup: the id is no Clerk organization, and the email is a free-mail one. */
export const CUSTOMER_PERSONAL = {
	id: "user_2grace00000000000000000",
	name: "Grace Hopper",
	email: "grace.hopper@gmail.com",
	created_at: MS("2026-10-05T08:00:00.000Z"),
	stripe_id: null,
	env: "live",
	metadata: {},
	subscriptions: [],
	licenses: [],
	balances: {},
}

export const CUSTOMERS = [CUSTOMER_ACME, CUSTOMER_GLOBEX, CUSTOMER_PERSONAL]

// ---------------------------------------------------------------------------
// Webhook payloads
// ---------------------------------------------------------------------------

export const BILLING_UPDATED_UPGRADE = {
	type: "billing.updated",
	data: {
		object: "billing.updated",
		customer_id: ORG_ACME,
		plan_changes: [
			{
				action: "activated",
				subscription: {
					plan_id: "pro",
					status: "active",
					past_due: false,
					started_at: MS("2026-01-14T09:20:00.000Z"),
					canceled_at: null,
					expires_at: null,
					trial_ends_at: null,
					current_period_start: MS("2026-11-01T09:20:00.000Z"),
					current_period_end: MS("2026-12-01T09:20:00.000Z"),
				},
				previous_attributes: null,
				item_changes: [],
			},
			{
				action: "expired",
				subscription: {
					plan_id: "free",
					status: "expired",
					past_due: false,
					started_at: MS("2025-11-01T09:00:00.000Z"),
					canceled_at: MS("2026-01-14T09:20:00.000Z"),
					expires_at: MS("2026-01-14T09:20:00.000Z"),
					trial_ends_at: null,
					current_period_start: null,
					current_period_end: null,
				},
				previous_attributes: { status: "active" },
				item_changes: [],
			},
		],
		tags: [],
	},
}

export const BILLING_UPDATED_ENTITY = {
	type: "billing.updated",
	data: {
		object: "billing.updated",
		customer_id: ORG_ACME,
		entity_id: "workspace_abc",
		plan_changes: [{ action: "activated", subscription: { plan_id: "pro" }, previous_attributes: null }],
		tags: [],
	},
}

export const LIMIT_REACHED_MESSAGES = {
	type: "balances.limit_reached",
	data: { customer_id: ORG_ACME, feature_id: "messages", limit_type: "included" },
}

export const USAGE_ALERT_MESSAGES = {
	type: "balances.usage_alert_triggered",
	data: {
		customer_id: ORG_ACME,
		feature_id: "messages",
		usage_alert: { name: "80% usage warning", threshold: 80, threshold_type: "usage_percentage" },
	},
}

/** An event type Hazel does not handle: acknowledged, nothing written. */
export const AUTO_TOPUP_SUCCEEDED = {
	type: "billing.auto_topup_succeeded",
	id: "evt_auto_topup_2abc123",
	occurred_at: MS("2026-11-10T12:00:00.000Z"),
	data: { customer_id: ORG_ACME, feature_id: "messages", quantity_granted: 1_000 },
}
