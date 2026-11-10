/**
 * The health score's settings and its explained result (`docs/customers/tech-design.md` §4).
 *
 * Each component scores 0–100 from its inputs through threshold steps; components without data
 * drop out and their weight is shared across the rest; the score is the weighted sum, banded into
 * a status. Churned accounts get no score (`unknown`).
 */
import { Schema } from "effect"
import { HealthComponentKey, HealthStatus, SignalTemplate } from "./enums"

const Score = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))

/** First step whose `min` ≤ the input wins; sorted by `min` descending (no `Infinity`: stored as JSON). */
export const MinStep = Schema.Struct({ min: Schema.Number, score: Score })
export type MinStep = typeof MinStep.Type

/** First step whose `max` ≥ the input wins; steps are sorted by `max` ascending. */
export const MaxStep = Schema.Struct({ max: Schema.Number, score: Score })
export type MaxStep = typeof MaxStep.Type

export const HealthWeights = Schema.Struct({
	usage: Score,
	engagement: Score,
	billing: Score,
	signals: Score,
})
export type HealthWeights = typeof HealthWeights.Type

export const HealthBands = Schema.Struct({
	/** Score ≥ this is `healthy`. */
	healthyMin: Score,
	/** Score ≥ this (and below `healthyMin`) is `at_risk`; below is `critical`. */
	atRiskMin: Score,
})
export type HealthBands = typeof HealthBands.Type

export const HealthSteps = Schema.Struct({
	usage: Schema.Struct({
		/** Share of the inputs: `activeRatio` (60%) and `trend` (40%). */
		activeRatioWeight: Score,
		/** Active users (30d) ÷ contacts, 0–1. */
		activeRatio: Schema.Array(MinStep),
		/** Active users trend, percent (7d avg vs prior 28d avg). */
		trend: Schema.Array(MinStep),
	}),
	engagement: Schema.Struct({
		/** Days since the account's last activity. */
		daysSinceActive: Schema.Array(MaxStep),
	}),
	billing: Schema.Struct({
		pastDue: Score,
		overdueOverWeek: Score,
		overdue: Score,
		cancelScheduled: Score,
		ok: Score,
	}),
	signals: Schema.Struct({
		/** Subtracted from 100 per open risk signal of that severity, floored at 0. */
		high: Score,
		medium: Score,
		low: Score,
	}),
})
export type HealthSteps = typeof HealthSteps.Type

/** The org's health configuration (stored in `customer_settings`). */
export const HealthSettings = Schema.Struct({
	weights: HealthWeights.check(
		Schema.makeFilter((weights) =>
			weights.usage + weights.engagement + weights.billing + weights.signals === 100
				? undefined
				: "Weights must sum to 100",
		),
	),
	bands: HealthBands.check(
		Schema.makeFilter((bands) =>
			bands.atRiskMin < bands.healthyMin ? undefined : "The at-risk band must start below healthy",
		),
	),
	steps: HealthSteps,
	/** Templates whose signals the `signals` component ignores (avoids `health_drop` feeding itself). */
	excludedTemplates: Schema.Array(SignalTemplate),
})
export type HealthSettings = typeof HealthSettings.Type

export const DEFAULT_HEALTH_SETTINGS: HealthSettings = {
	weights: { usage: 35, engagement: 25, billing: 25, signals: 15 },
	bands: { healthyMin: 70, atRiskMin: 40 },
	steps: {
		usage: {
			activeRatioWeight: 60,
			activeRatio: [
				{ min: 0.6, score: 100 },
				{ min: 0.4, score: 75 },
				{ min: 0.2, score: 50 },
				{ min: 0.0001, score: 25 },
				{ min: 0, score: 0 },
			],
			trend: [
				{ min: 10, score: 100 },
				{ min: -10, score: 75 },
				{ min: -30, score: 40 },
				{ min: -1_000_000, score: 10 },
			],
		},
		engagement: {
			daysSinceActive: [
				{ max: 1, score: 100 },
				{ max: 3, score: 90 },
				{ max: 7, score: 75 },
				{ max: 14, score: 50 },
				{ max: 30, score: 25 },
				{ max: 1_000_000, score: 0 },
			],
		},
		billing: { pastDue: 20, overdueOverWeek: 30, overdue: 60, cancelScheduled: 40, ok: 100 },
		signals: { high: 30, medium: 15, low: 5 },
	},
	excludedTemplates: ["health_drop", "near_limit", "seat_growth"],
}

/** One component of an account's score, and why. */
export const HealthComponentResult = Schema.Struct({
	key: HealthComponentKey,
	/** Null when the component had no data (`excluded`). */
	score: Schema.NullOr(Score),
	/** The configured weight, percent. */
	weight: Score,
	/** After redistributing the excluded components' weight, percent (0 when excluded). */
	effectiveWeight: Schema.Number,
	excluded: Schema.Boolean,
	/** Plain-language inputs, e.g. "4 of 12 contacts active in 30 days; trend −18%". */
	why: Schema.String,
})
export type HealthComponentResult = typeof HealthComponentResult.Type

/** An account's score on a day (`customer_health_daily`, and the breakdown on the customer page). */
export const HealthBreakdown = Schema.Struct({
	score: Schema.NullOr(Score),
	status: HealthStatus,
	components: Schema.Array(HealthComponentResult),
})
export type HealthBreakdown = typeof HealthBreakdown.Type
