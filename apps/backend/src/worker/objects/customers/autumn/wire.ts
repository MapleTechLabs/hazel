/**
 * The Autumn API objects and webhook payloads Hazel reads, as loose schemas.
 *
 * Verified against Autumn's OpenAPI document for **2.5.0** — the version every request pins
 * ({@link AUTUMN_API_VERSION}) — and the handlers behind it (`useautumn/autumn`,
 * `shared/api/customers/**`, `server/src/internal/orgs/orgRouter.ts`):
 * `GET /v1/organization`, `GET /v1/organization/me`, `POST /v1/customers.list`,
 * `POST /v1/customers.get`, `POST /v1/subscriptions.list`, `POST /v1/plans.list`,
 * `POST /v1/features.list`.
 *
 * **Pinning the version is not optional.** Without an `x-api-version` header Autumn picks the
 * version from the organization's creation date (`apiVersionMiddleware`), so the same request
 * answers in different shapes for different customers of Hazel. Every request here sends it.
 *
 * Every field Hazel does not need is left out, and nearly everything is optional and nullable: a
 * webhook delivery is shaped by the endpoint, not by this pin, and a decode failure would 400 a
 * delivery we could otherwise have handled.
 *
 * Timestamps are Unix **milliseconds** (Stripe's are seconds; do not copy that code). Money on a
 * plan is in **major** units ("in major currency units (e.g. dollars)"), which is why
 * {@link minorUnitsOf} exists: Hazel stores minor units.
 */
import type { IsoTimestamp } from "@hazel/domain/customers"
import { Schema } from "effect"

/** The API version every request pins, so an organization's age cannot change the wire shape. */
export const AUTUMN_API_VERSION = "2.5.0"

const Nullable = <S extends Schema.Top>(schema: S) => Schema.optionalKey(Schema.NullOr(schema))

/** `sandbox` or `live`: which half of an Autumn organization a key opens. */
export const AutumnEnv = Schema.Literals(["sandbox", "live"])
export type AutumnEnv = typeof AutumnEnv.Type

/** `GET /v1/organization/me`: the organization *and* the environment the key opens. */
export const AutumnOrganizationMe = Schema.Struct({
	id: Schema.String,
	name: Nullable(Schema.String),
	env: AutumnEnv,
})

/**
 * `GET /v1/organization`: the same organization, with the currency its plan amounts are quoted in
 * (`createOrgResponse`, `default_currency`). `/me` does not carry it and a customer never does.
 */
export const AutumnOrganization = Schema.Struct({
	default_currency: Nullable(Schema.String),
})

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

/** `POST /v1/features.list` → the organization's features, which name the usage metrics. */
const AutumnFeature = Schema.Struct({
	id: Schema.String,
	name: Nullable(Schema.String),
	/** `boolean` | `metered` | `credit_system` | `ai_credit_system`. */
	type: Nullable(Schema.String),
})

export const AutumnFeaturesPage = Schema.Struct({ list: Schema.Array(AutumnFeature) })

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/**
 * A plan's base price, or a plan item's price. Amounts are in **major** units of the organization's
 * `default_currency`; `interval` is `one_off` | `week` | `month` | `quarter` | `semi_annual` |
 * `year`, and `one_off` is not recurring at all.
 */
const AutumnPriceFields = {
	amount: Nullable(Schema.Number),
	interval: Nullable(Schema.String),
	interval_count: Nullable(Schema.Number),
}

const AutumnPlanItem = Schema.Struct({
	feature_id: Nullable(Schema.String),
	price: Nullable(
		Schema.Struct({
			...AutumnPriceFields,
			/** `prepaid` (units bought upfront, e.g. seats) or `usage_based` (billed after the period). */
			billing_method: Nullable(Schema.String),
		}),
	),
})

export const AutumnPlan = Schema.Struct({
	id: Schema.String,
	name: Nullable(Schema.String),
	/** At most one version of a plan is active; Hazel prices from that one. */
	active: Nullable(Schema.Boolean),
	/** Plans of one group are mutually exclusive: a scheduled one replaces the current one. */
	group: Nullable(Schema.String),
	/** Attached to every new customer, and scheduled when a plan of its group is canceled (free tiers). */
	auto_enable: Nullable(Schema.Boolean),
	price: Nullable(Schema.Struct(AutumnPriceFields)),
	items: Nullable(Schema.Array(AutumnPlanItem)),
	/** Set when the plan comes with a free trial: `duration_length` × `duration_type` (`day`, `month`, `year`). */
	free_trial: Nullable(
		Schema.Struct({
			duration_length: Nullable(Schema.Number),
			duration_type: Nullable(Schema.String),
		}),
	),
})
export type AutumnPlan = typeof AutumnPlan.Type

export const AutumnPlansPage = Schema.Struct({ list: Schema.Array(AutumnPlan) })

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/**
 * One grant behind a balance (`breakdown[]`): the plan it comes from, the units bought on top of
 * the plan's included ones (`prepaid_grant`), and the price those units are billed at — `amount`
 * per `billing_units` units, unset for a tiered price. `source: "entity"` is a sub-customer's.
 */
const AutumnBalanceGrant = Schema.Struct({
	plan_id: Nullable(Schema.String),
	prepaid_grant: Nullable(Schema.Number),
	source: Nullable(Schema.String),
	price: Nullable(
		Schema.Struct({
			amount: Nullable(Schema.Number),
			billing_units: Nullable(Schema.Number),
			billing_method: Nullable(Schema.String),
		}),
	),
})

/** One feature's balance on a customer: what the plan grants, and what is used. */
export const AutumnBalance = Schema.Struct({
	feature_id: Schema.String,
	feature: Nullable(Schema.Struct({ name: Nullable(Schema.String) })),
	/** Included + prepaid units for the period. */
	granted: Nullable(Schema.Number),
	usage: Nullable(Schema.Number),
	unlimited: Nullable(Schema.Boolean),
	breakdown: Nullable(Schema.Array(AutumnBalanceGrant)),
})
export type AutumnBalance = typeof AutumnBalance.Type

/** A license seat pool a plan grants: `granted` seats, `usage` assigned. */
export const AutumnLicense = Schema.Struct({
	granted: Nullable(Schema.Number),
	usage: Nullable(Schema.Number),
})
export type AutumnLicense = typeof AutumnLicense.Type

/**
 * A customer's recurring plan. The same shape comes inline on a customer (`subscriptions[]`, with
 * the customer's own `plan` when `expand` asks for it) and from `POST /v1/subscriptions.list`,
 * which adds `customer_id` and an `expired` status — the only place an ended plan is visible, since
 * a customer only ever lists its `active`, `past_due` and `scheduled` ones (`RELEVANT_STATUSES`).
 *
 * `id` is the `subscription_id` the app chose at attach time, else Autumn's own: unique among a
 * customer's live plans only, so another customer — or this one's ended plan — may hold it too.
 */
export const AutumnSubscription = Schema.Struct({
	id: Schema.String,
	plan_id: Schema.String,
	/** The customer's own version of the plan (custom prices included); `expand` only. */
	plan: Nullable(AutumnPlan),
	/** `active` | `scheduled` | `expired`. */
	status: Nullable(Schema.String),
	past_due: Nullable(Schema.Boolean),
	add_on: Nullable(Schema.Boolean),
	/** The plan's `auto_enable`. */
	auto_enable: Nullable(Schema.Boolean),
	/** Unix ms. */
	started_at: Nullable(Schema.Number),
	canceled_at: Nullable(Schema.Number),
	expires_at: Nullable(Schema.Number),
	/** Only set while the plan is actually trialing (`getApiSubscriptionV2`). */
	trial_ends_at: Nullable(Schema.Number),
	/** The processor's billing period (Stripe, RevenueCat); unset for a plan nothing ever billed. */
	current_period_start: Nullable(Schema.Number),
	current_period_end: Nullable(Schema.Number),
	quantity: Nullable(Schema.Number),
	/** `entity`: a sub-customer's plan (a seat, a project), not the account's. */
	scope: Nullable(Schema.String),
	/** `subscriptions.list` only. */
	customer_id: Nullable(Schema.String),
	entity_id: Nullable(Schema.String),
})
export type AutumnSubscription = typeof AutumnSubscription.Type

export const AutumnSubscriptionsPage = Schema.Struct({
	list: Schema.Array(AutumnSubscription),
	has_more: Nullable(Schema.Boolean),
	next_cursor: Nullable(Schema.String),
})

export const AutumnCustomer = Schema.Struct({
	/** The id the caller chose for the customer: a Clerk organization id in Hazel's setup. */
	id: Nullable(Schema.String),
	name: Nullable(Schema.String),
	email: Nullable(Schema.String),
	/** Unix ms. */
	created_at: Nullable(Schema.Number),
	env: Nullable(AutumnEnv),
	subscriptions: Nullable(Schema.Array(AutumnSubscription)),
	/** One-off plans: only counted, against the plans a listing returns per customer. */
	purchases: Nullable(Schema.Array(Schema.Unknown)),
	licenses: Nullable(Schema.Array(AutumnLicense)),
	/** Keyed by feature id. */
	balances: Nullable(Schema.Record(Schema.String, AutumnBalance)),
})
export type AutumnCustomer = typeof AutumnCustomer.Type

export const AutumnCustomersPage = Schema.Struct({
	list: Schema.Array(AutumnCustomer),
	next_cursor: Nullable(Schema.String),
})

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * Every delivery: `{ type, data }`, with `id` and `occurred_at` on the event types that carry them
 * (the auto-top-up ones). Svix's `svix-id` is the dedupe key for the rest.
 */
export const AutumnWebhookEnvelope = Schema.Struct({
	type: Schema.String,
	id: Nullable(Schema.String),
	/** Unix ms. */
	occurred_at: Nullable(Schema.Number),
	data: Schema.Unknown,
})
export type AutumnWebhookEnvelope = typeof AutumnWebhookEnvelope.Type

/** `billing.updated`: one entry per plan the change touched. */
export const AutumnBillingUpdated = Schema.Struct({
	customer_id: Schema.String,
	entity_id: Nullable(Schema.String),
	plan_changes: Schema.Array(
		Schema.Struct({
			/** `activated` | `scheduled` | `updated` | `expired`. */
			action: Nullable(Schema.String),
			subscription: Nullable(Schema.Struct({ plan_id: Nullable(Schema.String) })),
		}),
	),
})
export type AutumnBillingUpdated = typeof AutumnBillingUpdated.Type

/** `balances.limit_reached` and `balances.usage_alert_triggered` share these fields. */
export const AutumnBalanceEvent = Schema.Struct({
	customer_id: Schema.String,
	feature_id: Schema.String,
	entity_id: Nullable(Schema.String),
	/** `included` | `max_purchase` | `spend_limit` | `usage_limit`; `limit_reached` only. */
	limit_type: Nullable(Schema.String),
	/** `usage_alert_triggered` only. */
	usage_alert: Nullable(
		Schema.Struct({
			threshold: Nullable(Schema.Number),
			threshold_type: Nullable(Schema.String),
		}),
	),
})
export type AutumnBalanceEvent = typeof AutumnBalanceEvent.Type

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** 10000-01-01 in ms: past it `toISOString` widens the year, which is no `IsoTimestamp`. */
const MAX_MS = 253_402_300_800_000

/**
 * An ISO instant from an Autumn Unix-**millisecond** timestamp; null when Autumn sent none, or one
 * outside 1970–9999, so every instant passes ingest's `IsoTimestamp` check.
 */
export const isoOf = (ms: number | null | undefined): IsoTimestamp | null =>
	ms === null || ms === undefined || !(ms >= 0 && ms < MAX_MS) ? null : new Date(ms).toISOString()

/**
 * Stripe's zero- and three-decimal currencies, which is what Autumn bills through
 * (`shared/utils/currencyUtils/stripeCurrencies.ts`): a plan's major-unit amount becomes minor
 * units by this currency's factor, so ¥5000 is `5000` and not `500000`.
 */
const ZERO_DECIMAL: ReadonlySet<string> = new Set([
	"bif",
	"clp",
	"djf",
	"gnf",
	"jpy",
	"kmf",
	"krw",
	"mga",
	"pyg",
	"rwf",
	"ugx",
	"vnd",
	"vuv",
	"xaf",
	"xof",
	"xpf",
])
const THREE_DECIMAL: ReadonlySet<string> = new Set(["bhd", "jod", "kwd", "omr", "tnd"])

/** How many minor units one major unit of `currency` is. */
export const minorUnitsOf = (currency: string): number => {
	const code = currency.toLowerCase()
	if (ZERO_DECIMAL.has(code)) return 1
	return THREE_DECIMAL.has(code) ? 1000 : 100
}

/** How many months one billing period covers, as a multiplier onto a monthly amount. */
const MONTHLY_FACTOR: ReadonlyMap<string, number> = new Map([
	["month", 1],
	["year", 1 / 12],
	["quarter", 1 / 3],
	["semi_annual", 1 / 6],
	["week", 52 / 12],
	["day", 365 / 12],
])

/**
 * The monthly share of one period's amount: `/year` is a twelfth, `/quarter` a third. Null for a
 * cadence with no monthly share at all (`one_off`) or one Autumn added since.
 */
export const monthlyFactorOf = (price: {
	readonly interval?: string | null
	readonly interval_count?: number | null
}): number | null => {
	const factor = price.interval == null ? undefined : MONTHLY_FACTOR.get(price.interval)
	if (factor === undefined) return null
	const count = price.interval_count
	return factor / (count != null && count > 0 ? count : 1)
}

const DASHBOARD = "https://app.useautumn.com"

/** Sandbox records live under `/sandbox` in the dashboard; live ones at the root. */
export const customerUrlOf = (id: string, env: AutumnEnv): string =>
	`${DASHBOARD}${env === "sandbox" ? "/sandbox" : ""}/customers/${encodeURIComponent(id)}`

/**
 * The environment an Autumn secret key is for, from its prefix (`am_sk_live_…` / `am_sk_test_…`,
 * `_oauth_` variants included); null for a key whose prefix does not say.
 */
export const envOfKey = (apiKey: string): AutumnEnv | null => {
	if (apiKey.startsWith("am_sk_live_")) return "live"
	return apiKey.startsWith("am_sk_test_") ? "sandbox" : null
}

/** The connection's provider account: one Autumn organization's *environment*, never both. */
export const accountIdOf = (organizationId: string, env: AutumnEnv): string => `${organizationId}:${env}`
