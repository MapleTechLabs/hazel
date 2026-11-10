/**
 * Signal rules: one config schema per template, the account scope a rule applies to, and the
 * templates' metadata (kind, default severity, the sources each needs, how its evidence draws).
 * The evaluation itself is the backend's (`docs/customers/tech-design.md` §4).
 */
import { Schema } from "effect"
import {
	type CustomerProvider,
	type EvidenceViz,
	LifecycleStage,
	type SignalKind,
	SignalSeverity,
	type SignalTemplate,
} from "./enums"

const Days = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 365 }))
const Pct = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))
const Count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100_000 }))

/** No contact activity for `inactiveDays`, after ≥ `minPriorActiveUsers` active in the `priorWindowDays` before. */
export const InactiveConfig = Schema.TaggedStruct("inactive", {
	inactiveDays: Days,
	priorWindowDays: Days,
	minPriorActiveUsers: Count,
})

/** `metricKey`'s `recentDays` average down ≥ `dropPct`% vs the `baselineDays` average before it. */
export const UsageDropConfig = Schema.TaggedStruct("usage_drop", {
	metricKey: Schema.String,
	recentDays: Days,
	baselineDays: Days,
	dropPct: Pct,
})

/** A subscription `past_due`/`unpaid`, or an invoice open more than `overdueDays` past its due date. */
export const PaymentFailedConfig = Schema.TaggedStruct("payment_failed", {
	overdueDays: Days,
})

/** `cancelAtPeriodEnd` set, or (with `includeDowngrades`) a contraction in the last `downgradeWindowDays`. */
export const CancelScheduledConfig = Schema.TaggedStruct("cancel_scheduled", {
	includeDowngrades: Schema.Boolean,
	downgradeWindowDays: Days,
})

/** The trial ends within `daysBeforeEnd` and fewer than `minActiveUsers` were active in `activeWindowDays`. */
export const TrialEndingLowActivationConfig = Schema.TaggedStruct("trial_ending_low_activation", {
	daysBeforeEnd: Days,
	minActiveUsers: Count,
	activeWindowDays: Days,
})

/** First seen `minAgeDays`–`maxAgeDays` ago, and fewer than `minActiveContacts` contacts ever active. */
export const OnboardingStalledConfig = Schema.TaggedStruct("onboarding_stalled", {
	minAgeDays: Days,
	maxAgeDays: Days,
	minActiveContacts: Count,
}).check(
	Schema.makeFilter((config) =>
		config.minAgeDays <= config.maxAgeDays ? undefined : "The minimum age must not exceed the maximum",
	),
)

/** Health fell ≥ `dropPoints` within `windowDays`, or (with `onCritical`) entered `critical`. */
export const HealthDropConfig = Schema.TaggedStruct("health_drop", {
	dropPoints: Count,
	windowDays: Days,
	onCritical: Schema.Boolean,
})

/** The most active contact of the last `windowDays` has been inactive for `inactiveDays`. */
export const ChampionInactiveConfig = Schema.TaggedStruct("champion_inactive", {
	windowDays: Days,
	inactiveDays: Days,
})

/** A metered metric at ≥ `thresholdPct`% of its plan limit; `metricKeys` empty = every limited metric. */
export const NearLimitConfig = Schema.TaggedStruct("near_limit", {
	thresholdPct: Pct,
	metricKeys: Schema.Array(Schema.String),
})

/** Active users up ≥ `growthPct`% over `windowDays`, from at least `minActiveUsers`. */
export const SeatGrowthConfig = Schema.TaggedStruct("seat_growth", {
	growthPct: Pct,
	windowDays: Days,
	minActiveUsers: Count,
})

/** A rule's thresholds; the `_tag` is its template. */
export const RuleConfig = Schema.Union([
	InactiveConfig,
	UsageDropConfig,
	PaymentFailedConfig,
	CancelScheduledConfig,
	TrialEndingLowActivationConfig,
	OnboardingStalledConfig,
	HealthDropConfig,
	ChampionInactiveConfig,
	NearLimitConfig,
	SeatGrowthConfig,
])
export type RuleConfig = typeof RuleConfig.Type

/** Which accounts a rule evaluates. Every field narrows; empty = all non-churned accounts. */
export const RuleScope = Schema.Struct({
	/** Only accounts with MRR > 0 (or a trial). */
	payingOnly: Schema.optionalKey(Schema.Boolean),
	lifecycleStages: Schema.optionalKey(Schema.Array(LifecycleStage)),
	planNames: Schema.optionalKey(
		Schema.Array(Schema.String.check(Schema.isMaxLength(100))).check(Schema.isMaxLength(50)),
	),
	minMrrMinor: Schema.optionalKey(Schema.Int),
	tagsAny: Schema.optionalKey(
		Schema.Array(Schema.String.check(Schema.isMaxLength(50))).check(Schema.isMaxLength(50)),
	),
})
export type RuleScope = typeof RuleScope.Type

/** A rule as the editor submits it (create, update, dry-run). */
export const RuleDraft = Schema.Struct({
	name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
	severity: SignalSeverity,
	config: RuleConfig,
	scope: RuleScope,
	enabled: Schema.Boolean,
})
export type RuleDraft = typeof RuleDraft.Type

export interface TemplateMeta {
	readonly template: SignalTemplate
	readonly kind: SignalKind
	readonly name: string
	/** One line for the rules list; `{x}` placeholders are the config's fields. */
	readonly description: string
	readonly defaultSeverity: SignalSeverity
	readonly defaultConfig: RuleConfig
	/** The template can only match with at least one of these connected. */
	readonly requiredSources: ReadonlyArray<CustomerProvider>
	readonly viz: EvidenceViz
	/**
	 * The first evaluation after a backfill records its matches as `dismissed` (reason `baseline`)
	 * instead of opening them: they reopen only once worse by a full step. Off for the
	 * time-bounded, act-now templates (billing, trials).
	 */
	readonly baselineOnBackfill: boolean
	/** Signals of this template are left out of the health score's `signals` component by default. */
	readonly excludedFromHealth: boolean
}

const ACTIVITY: ReadonlyArray<CustomerProvider> = ["clerk", "maple"]
const BILLING: ReadonlyArray<CustomerProvider> = ["stripe", "autumn"]

/** Each template's metadata, keyed by its own name. */
type TemplateTable = { readonly [T in SignalTemplate]: TemplateMeta & { readonly template: T } }

export const TEMPLATES: TemplateTable = {
	inactive: {
		template: "inactive",
		kind: "risk",
		name: "Stopped using the product",
		description: "No activity for {inactiveDays} days after being active",
		defaultSeverity: "medium",
		defaultConfig: { _tag: "inactive", inactiveDays: 14, priorWindowDays: 30, minPriorActiveUsers: 1 },
		requiredSources: ACTIVITY,
		viz: "last_active",
		baselineOnBackfill: true,
		excludedFromHealth: false,
	},
	usage_drop: {
		template: "usage_drop",
		kind: "risk",
		name: "Usage dropped",
		description:
			"{metricKey} {recentDays}-day average down {dropPct}% vs the previous {baselineDays} days",
		defaultSeverity: "medium",
		defaultConfig: {
			_tag: "usage_drop",
			metricKey: "active_users",
			recentDays: 7,
			baselineDays: 28,
			dropPct: 30,
		},
		requiredSources: ACTIVITY,
		viz: "series",
		baselineOnBackfill: true,
		excludedFromHealth: false,
	},
	payment_failed: {
		template: "payment_failed",
		kind: "risk",
		name: "Payment failing",
		description: "Subscription past due, or an invoice open {overdueDays} days past due",
		defaultSeverity: "high",
		defaultConfig: { _tag: "payment_failed", overdueDays: 7 },
		requiredSources: BILLING,
		viz: "amount",
		baselineOnBackfill: false,
		excludedFromHealth: false,
	},
	cancel_scheduled: {
		template: "cancel_scheduled",
		kind: "risk",
		name: "Cancellation scheduled",
		description: "Set to cancel at period end, or downgraded",
		defaultSeverity: "high",
		defaultConfig: { _tag: "cancel_scheduled", includeDowngrades: true, downgradeWindowDays: 14 },
		requiredSources: BILLING,
		viz: "delta",
		baselineOnBackfill: false,
		excludedFromHealth: false,
	},
	trial_ending_low_activation: {
		template: "trial_ending_low_activation",
		kind: "risk",
		name: "Trial ending, low activation",
		description: "Trial ends within {daysBeforeEnd} days and under {minActiveUsers} active users",
		defaultSeverity: "medium",
		defaultConfig: {
			_tag: "trial_ending_low_activation",
			daysBeforeEnd: 5,
			minActiveUsers: 2,
			activeWindowDays: 7,
		},
		requiredSources: BILLING,
		viz: "ratio",
		baselineOnBackfill: false,
		excludedFromHealth: false,
	},
	onboarding_stalled: {
		template: "onboarding_stalled",
		kind: "risk",
		name: "Onboarding stalled",
		description: "{minAgeDays}–{maxAgeDays} days old with under {minActiveContacts} active contacts",
		defaultSeverity: "low",
		defaultConfig: { _tag: "onboarding_stalled", minAgeDays: 7, maxAgeDays: 30, minActiveContacts: 2 },
		requiredSources: ACTIVITY,
		viz: "ratio",
		baselineOnBackfill: true,
		excludedFromHealth: false,
	},
	health_drop: {
		template: "health_drop",
		kind: "risk",
		name: "Health dropped",
		description: "Health fell {dropPoints} points in {windowDays} days, or turned critical",
		defaultSeverity: "medium",
		defaultConfig: { _tag: "health_drop", dropPoints: 20, windowDays: 7, onCritical: true },
		requiredSources: [],
		viz: "delta",
		baselineOnBackfill: true,
		excludedFromHealth: true,
	},
	champion_inactive: {
		template: "champion_inactive",
		kind: "risk",
		name: "Champion went quiet",
		description: "The most active user of the last {windowDays} days inactive for {inactiveDays} days",
		defaultSeverity: "medium",
		defaultConfig: { _tag: "champion_inactive", windowDays: 30, inactiveDays: 14 },
		requiredSources: ACTIVITY,
		viz: "last_active",
		baselineOnBackfill: true,
		excludedFromHealth: false,
	},
	near_limit: {
		template: "near_limit",
		kind: "opportunity",
		name: "Near plan limit",
		description: "A metered feature at {thresholdPct}% of its plan limit",
		defaultSeverity: "medium",
		defaultConfig: { _tag: "near_limit", thresholdPct: 90, metricKeys: [] },
		requiredSources: ["autumn"],
		viz: "limit",
		baselineOnBackfill: true,
		excludedFromHealth: true,
	},
	seat_growth: {
		template: "seat_growth",
		kind: "opportunity",
		name: "Seats growing",
		description: "Active users up {growthPct}% in {windowDays} days",
		defaultSeverity: "low",
		defaultConfig: { _tag: "seat_growth", growthPct: 50, windowDays: 30, minActiveUsers: 3 },
		requiredSources: ACTIVITY,
		viz: "delta",
		baselineOnBackfill: true,
		excludedFromHealth: true,
	},
}

/** `severity` raised by `step` levels, capped at `high`. */
export const escalate = (floor: SignalSeverity, step: 0 | 1 | 2): SignalSeverity => {
	const order = SignalSeverity.literals
	return order[Math.min(order.indexOf(floor) + step, order.length - 1)]
}
