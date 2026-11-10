/**
 * What the read RPCs answer: aggregates, time series, per-account detail and dry runs
 * (`docs/customers/tech-design.md` §2 "RPC-only"). Live lists come from the synced collections.
 */
import { CustomerAccountId } from "@hazel/schema"
import { Schema } from "effect"
import { JsonDate } from "../models/utils"
import { ContactActivityStatus, CustomersRange, HealthStatus, SignalSeverity } from "./enums"
import { Day, SeriesPoint, SignalEvidence } from "./evidence"
import { HealthBreakdown } from "./health"
import { Account, Contact, Event, ExternalRef, Invoice, Subscription } from "./models"

/** A page of `items`; pass `nextCursor` back as `cursor` for the next one (null: no more). */
export const Page = <S extends Schema.Top>(item: S) =>
	Schema.Struct({ items: Schema.Array(item), nextCursor: Schema.NullOr(Schema.String) })

export const PageRequest = {
	cursor: Schema.optionalKey(Schema.String),
	/** Clamped to 100. */
	limit: Schema.optionalKey(Schema.Int),
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/** A KPI over the range, and over the previous range of the same length. */
export const Kpi = Schema.Struct({
	value: Schema.Number,
	previous: Schema.NullOr(Schema.Number),
	deltaPct: Schema.NullOr(Schema.Number),
})
export type Kpi = typeof Kpi.Type

export const OverviewKpis = Schema.Struct({
	mrrMinor: Kpi,
	payingCustomers: Kpi,
	/** ≥ 1 active user in 30 days. */
	activeCustomers: Kpi,
	wau: Kpi,
	mau: Kpi,
	/** WAU ÷ MAU, percent. */
	stickinessPct: Kpi,
	/** Accounts that churned in the range. */
	logoChurn: Kpi,
	/** MRR of accounts with an open high-severity risk signal (now; `previous` from `customer_org_daily`). */
	atRiskMrrMinor: Kpi,
	/** Net revenue retention over the range, percent; null without MRR at its start. */
	nrrPct: Schema.NullOr(Kpi),
})
export type OverviewKpis = typeof OverviewKpis.Type

/** MRR movements in one bucket, minor units; `contraction` and `churn` are negative. */
export const MrrMovementBucket = Schema.Struct({
	start: Day,
	new: Schema.Int,
	expansion: Schema.Int,
	reactivation: Schema.Int,
	contraction: Schema.Int,
	churn: Schema.Int,
	net: Schema.Int,
	/** Accounts per movement type, for the tooltip. */
	accounts: Schema.Struct({
		new: Schema.Int,
		expansion: Schema.Int,
		reactivation: Schema.Int,
		contraction: Schema.Int,
		churn: Schema.Int,
	}),
})
export type MrrMovementBucket = typeof MrrMovementBucket.Type

export const ActiveUsersPoint = Schema.Struct({
	day: Day,
	dau: Schema.Int,
	wau: Schema.Int,
	mau: Schema.Int,
})
export type ActiveUsersPoint = typeof ActiveUsersPoint.Type

export const HealthDistributionRow = Schema.Struct({
	status: HealthStatus,
	count: Schema.Int,
	mrrMinor: Schema.Int,
})
export type HealthDistributionRow = typeof HealthDistributionRow.Type

export const AccountBrief = Schema.Struct({
	accountId: CustomerAccountId,
	name: Schema.String,
	logoUrl: Schema.NullOr(Schema.String),
	planName: Schema.NullOr(Schema.String),
	mrrMinor: Schema.Int,
	/** When it churned / became a customer. */
	at: JsonDate,
})
export type AccountBrief = typeof AccountBrief.Type

/** An account whose usage (active users) moved most over the range. */
export const Mover = Schema.Struct({
	accountId: CustomerAccountId,
	name: Schema.String,
	logoUrl: Schema.NullOr(Schema.String),
	changePct: Schema.Number,
	series: Schema.Array(SeriesPoint),
})
export type Mover = typeof Mover.Type

export const OverviewResult = Schema.Struct({
	range: CustomersRange,
	/** The org's reporting currency; every money value is in it. */
	currency: Schema.String,
	/** The charts' bucket size: day for 7d/30d, week for 90d, month for 12m. */
	bucket: Schema.Literals(["day", "week", "month"]),
	kpis: OverviewKpis,
	mrrMovements: Schema.Array(MrrMovementBucket),
	activeUsers: Schema.Array(ActiveUsersPoint),
	healthDistribution: Schema.Array(HealthDistributionRow),
	topMovers: Schema.Struct({ gainers: Schema.Array(Mover), decliners: Schema.Array(Mover) }),
	recentChurn: Schema.Array(AccountBrief),
	recentNew: Schema.Array(AccountBrief),
	/** Which kinds of data exist, for the empty and partial states. */
	hasData: Schema.Struct({ activity: Schema.Boolean, billing: Schema.Boolean }),
})
export type OverviewResult = typeof OverviewResult.Type

// ---------------------------------------------------------------------------
// One account
// ---------------------------------------------------------------------------

/** A contact with its 30-day activity (events + sessions per day, oldest first). */
export const ContactRow = Schema.Struct({
	contact: Contact.Schema,
	status: ContactActivityStatus,
	activity: Schema.Array(SeriesPoint),
})
export type ContactRow = typeof ContactRow.Type

export const AccountDetail = Schema.Struct({
	account: Account.Schema,
	refs: Schema.Array(ExternalRef.Schema),
	subscriptions: Schema.Array(Subscription.Schema),
	upcomingInvoice: Schema.NullOr(Invoice.Schema),
	/** Open and past-due invoices (the payment issue banner). */
	openInvoices: Schema.Array(Invoice.Schema),
	/** Today's breakdown; null before the first compute. */
	health: Schema.NullOr(HealthBreakdown),
	/** 90 days of the health score. */
	healthSeries: Schema.Array(SeriesPoint),
	/** 30 days of daily active users. */
	activeUsersSeries: Schema.Array(SeriesPoint),
	/** The most active contacts and admins, ≤ 5: who to reach. */
	contactsToReach: Schema.Array(ContactRow),
	/** The latest ≤ 10 timeline events. */
	recentEvents: Schema.Array(Event.Schema),
})
export type AccountDetail = typeof AccountDetail.Type

export const MetricSeries = Schema.Struct({
	metricKey: Schema.String,
	name: Schema.String,
	unit: Schema.NullOr(Schema.String),
	points: Schema.Array(SeriesPoint),
	/** The latest plan limit, for a metered metric. */
	limit: Schema.NullOr(Schema.Number),
})
export type MetricSeries = typeof MetricSeries.Type

/** Daily values, oldest first, one per day of the window (0 for a day without data). */
export const Sparkline = Schema.Struct({
	accountId: CustomerAccountId,
	values: Schema.Array(Schema.Number),
})
export type Sparkline = typeof Sparkline.Type

// ---------------------------------------------------------------------------
// Dry runs
// ---------------------------------------------------------------------------

export const RuleMatch = Schema.Struct({
	accountId: CustomerAccountId,
	name: Schema.String,
	logoUrl: Schema.NullOr(Schema.String),
	mrrMinor: Schema.Int,
	severity: SignalSeverity,
	title: Schema.String,
	reason: Schema.String,
	evidence: SignalEvidence,
})
export type RuleMatch = typeof RuleMatch.Type

export const RuleDryRunResult = Schema.Struct({
	matchCount: Schema.Int,
	mrrMinor: Schema.Int,
	currency: Schema.String,
	/** Highest priority first, ≤ 10. */
	topMatches: Schema.Array(RuleMatch),
	/** Why the other accounts do not match, e.g. "Out of scope", "Below threshold", "No activity data". */
	nonMatches: Schema.Array(Schema.Struct({ reason: Schema.String, count: Schema.Int })),
	/** Against the rule's current signals (an existing rule) or none (a new one). */
	queueDelta: Schema.Struct({ opens: Schema.Int, resolves: Schema.Int, stays: Schema.Int }),
	/** The rule's template needs a source that is not connected. */
	missingSources: Schema.Array(Schema.String),
})
export type RuleDryRunResult = typeof RuleDryRunResult.Type

export const HealthDryRunResult = Schema.Struct({
	current: Schema.Array(HealthDistributionRow),
	proposed: Schema.Array(HealthDistributionRow),
	/** Accounts per `(from, to)` status pair that changes. */
	transitions: Schema.Array(Schema.Struct({ from: HealthStatus, to: HealthStatus, count: Schema.Int })),
	/** A few accounts that change band, with both breakdowns. */
	samples: Schema.Array(
		Schema.Struct({
			accountId: CustomerAccountId,
			name: Schema.String,
			current: HealthBreakdown,
			proposed: HealthBreakdown,
		}),
	),
})
export type HealthDryRunResult = typeof HealthDryRunResult.Type
