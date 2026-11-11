/**
 * The health score (`docs/customers/tech-design.md` §4.3), pure: compute, the health dry run and
 * the tests share it.
 *
 * Each component scores 0–100 through its threshold steps or drops out without data; the excluded
 * components' weight is shared by the rest (`effectiveWeight = w / Σ w available × 100`); the score
 * is the weighted sum, banded. No score (`unknown`) for an account that is not a customer (a lead or
 * churned: nothing to retain), or when only `signals` is left.
 */
import type {
	HealthBreakdown,
	HealthComponentKey,
	HealthComponentResult,
	HealthSettings,
	HealthStatus,
	MaxStep,
	MinStep,
} from "@hazel/domain/customers"

export interface BillingHealthInputs {
	readonly pastDue: boolean
	/** An open invoice more than 7 days past its due date. */
	readonly overdueOverWeek: boolean
	readonly overdue: boolean
	readonly cancelScheduled: boolean
}

export interface HealthInputs {
	/** Paying, trialing or past due. Leads and churned accounts get no score. */
	readonly customer: boolean
	/** The org has usage data (an activity source): without it usage and engagement drop out. */
	readonly hasActivityData: boolean
	readonly contactCount: number
	readonly activeUsers30d: number
	readonly trendPct: number | null
	/** Null: never active. */
	readonly daysSinceActive: number | null
	/** Null: no billing source, or no live subscription. */
	readonly billing: BillingHealthInputs | null
	/** Open (and snoozed) risk signals, without the excluded templates. */
	readonly openRisk: { readonly high: number; readonly medium: number; readonly low: number }
}

/** The first step (by `min`, descending) whose `min` ≤ `value`; the lowest one otherwise. */
export const minStep = (steps: ReadonlyArray<MinStep>, value: number): number => {
	const sorted = [...steps].sort((a, b) => b.min - a.min)
	return (sorted.find((step) => value >= step.min) ?? sorted[sorted.length - 1])?.score ?? 0
}

/** The first step (by `max`, ascending) whose `max` ≥ `value`; the highest one otherwise. */
export const maxStep = (steps: ReadonlyArray<MaxStep>, value: number): number => {
	const sorted = [...steps].sort((a, b) => a.max - b.max)
	return (sorted.find((step) => value <= step.max) ?? sorted[sorted.length - 1])?.score ?? 0
}

export const bandOf = (score: number, bands: HealthSettings["bands"]): HealthStatus =>
	score >= bands.healthyMin ? "healthy" : score >= bands.atRiskMin ? "at_risk" : "critical"

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value))}%`

interface Part {
	readonly score: number | null
	readonly why: string
}

const usage = (inputs: HealthInputs, settings: HealthSettings): Part => {
	if (!inputs.hasActivityData) return { score: null, why: "No usage data source connected" }
	const steps = settings.steps.usage
	const ratio = inputs.activeUsers30d / Math.max(inputs.contactCount, 1)
	const ratioScore = minStep(steps.activeRatio, ratio)
	const active = `${inputs.activeUsers30d} of ${plural(inputs.contactCount, "contact")} active in 30 days`
	if (inputs.trendPct === null) return { score: ratioScore, why: `${active}; no trend yet` }
	const weight = steps.activeRatioWeight / 100
	const score = Math.round(weight * ratioScore + (1 - weight) * minStep(steps.trend, inputs.trendPct))
	return { score, why: `${active}; trend ${signed(inputs.trendPct)}` }
}

const engagement = (inputs: HealthInputs, settings: HealthSettings): Part => {
	if (!inputs.hasActivityData) return { score: null, why: "No usage data source connected" }
	const steps = settings.steps.engagement.daysSinceActive
	if (inputs.daysSinceActive === null)
		return { score: maxStep(steps, Number.MAX_SAFE_INTEGER), why: "Never active" }
	const days = inputs.daysSinceActive
	return {
		score: maxStep(steps, days),
		why: days === 0 ? "Active today" : `Last active ${plural(days, "day")} ago`,
	}
}

const billing = (inputs: HealthInputs, settings: HealthSettings): Part => {
	if (inputs.billing === null) return { score: null, why: "No subscription" }
	const scores = settings.steps.billing
	const issues: Array<readonly [number, string]> = []
	if (inputs.billing.pastDue) issues.push([scores.pastDue, "Payment past due"])
	if (inputs.billing.overdueOverWeek)
		issues.push([scores.overdueOverWeek, "Invoice overdue for over a week"])
	else if (inputs.billing.overdue) issues.push([scores.overdue, "Invoice overdue"])
	if (inputs.billing.cancelScheduled) issues.push([scores.cancelScheduled, "Cancellation scheduled"])
	if (issues.length === 0) return { score: scores.ok, why: "Paid up" }
	return {
		score: Math.min(...issues.map(([score]) => score)),
		why: issues.map(([, why]) => why).join("; "),
	}
}

const signals = (inputs: HealthInputs, settings: HealthSettings): Part => {
	const { high, medium, low } = inputs.openRisk
	const deduction =
		high * settings.steps.signals.high +
		medium * settings.steps.signals.medium +
		low * settings.steps.signals.low
	const total = high + medium + low
	if (total === 0) return { score: 100, why: "No open risk signals" }
	const parts = [
		high > 0 ? `${high} high` : null,
		medium > 0 ? `${medium} medium` : null,
		low > 0 ? `${low} low` : null,
	].filter((part) => part !== null)
	return {
		score: Math.max(0, 100 - deduction),
		why: `${plural(total, "open risk signal")} (${parts.join(", ")})`,
	}
}

const COMPONENTS: ReadonlyArray<
	readonly [HealthComponentKey, (inputs: HealthInputs, settings: HealthSettings) => Part]
> = [
	["usage", usage],
	["engagement", engagement],
	["billing", billing],
	["signals", signals],
]

export const scoreHealth = (inputs: HealthInputs, settings: HealthSettings): HealthBreakdown => {
	const parts = COMPONENTS.map(([key, score]) => ({
		key,
		...score(inputs, settings),
		weight: settings.weights[key],
	}))
	const available = parts.filter((part) => part.score !== null)
	const totalWeight = available.reduce((sum, part) => sum + part.weight, 0)
	const components: Array<HealthComponentResult> = parts.map((part) => ({
		key: part.key,
		score: part.score,
		weight: part.weight,
		effectiveWeight: part.score === null || totalWeight === 0 ? 0 : (part.weight / totalWeight) * 100,
		excluded: part.score === null,
		why: part.why,
	}))
	const onlySignals = available.every((part) => part.key === "signals")
	if (!inputs.customer || onlySignals || totalWeight === 0) {
		return { score: null, status: "unknown", components }
	}
	const score = Math.round(
		components.reduce((sum, part) => sum + (part.effectiveWeight / 100) * (part.score ?? 0), 0),
	)
	return { score, status: bandOf(score, settings.bands), components }
}
