import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerSettingsId } from "@hazel/schema"
import { Equal, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"
import { AccountRow } from "../../../../customers/queries"
import * as Select from "../../../../ui/select"
import * as Slider from "../../../../ui/slider"

/**
 * Health score settings (`docs/customers/spec.md` › Settings, Wonder `mao` / `aal`): the org's saved
 * `HealthSettings`, a draft the admin edits, its dry run, and one customer's breakdown.
 */

type HealthSettings = Customers.HealthSettings
type ComponentKey = Customers.HealthComponentKey

// DRAFT

const Steps = <F extends Schema.Struct.Fields>(fields: F) => Schema.Array(Schema.Struct(fields))

/**
 * `HealthSettings` without its checks: the draft holds whatever the inputs hold (an emptied field
 * is `NaN`) until it decodes as `HealthSettings` again.
 */
export const HealthDraft = Schema.Struct({
	weights: Schema.Struct({
		usage: Schema.Number,
		engagement: Schema.Number,
		billing: Schema.Number,
		signals: Schema.Number,
	}),
	bands: Schema.Struct({ healthyMin: Schema.Number, atRiskMin: Schema.Number }),
	steps: Schema.Struct({
		usage: Schema.Struct({
			activeRatioWeight: Schema.Number,
			activeRatio: Steps({ min: Schema.Number, score: Schema.Number }),
			trend: Steps({ min: Schema.Number, score: Schema.Number }),
		}),
		engagement: Schema.Struct({ daysSinceActive: Steps({ max: Schema.Number, score: Schema.Number }) }),
		billing: Schema.Struct({
			pastDue: Schema.Number,
			overdueOverWeek: Schema.Number,
			overdue: Schema.Number,
			cancelScheduled: Schema.Number,
			ok: Schema.Number,
		}),
		signals: Schema.Struct({ high: Schema.Number, medium: Schema.Number, low: Schema.Number }),
	}),
	excludedTemplates: Schema.Array(Customers.SignalTemplate),
})

export const COMPONENTS: ReadonlyArray<ComponentKey> = Customers.HealthComponentKey.literals

export const BandKey = Schema.Literals(["healthyMin", "atRiskMin"])
export type BandKey = typeof BandKey.Type

/** The threshold lists: `activeRatio` and `trend` are `MinStep`s, `daysSinceActive` `MaxStep`s. */
export const StepList = Schema.Literals(["activeRatio", "trend", "daysSinceActive"])
export type StepList = typeof StepList.Type

export const StepField = Schema.Literals(["threshold", "score"])
export type StepField = typeof StepField.Type

export const BILLING_FIELDS = ["ok", "overdue", "cancelScheduled", "overdueOverWeek", "pastDue"] as const
export const PENALTY_FIELDS = ["high", "medium", "low"] as const

/** A single 0–100 number of the steps: the usage mix, a billing state's score, a severity's penalty. */
export const ScoreField = Schema.Literals(["activeRatioWeight", ...BILLING_FIELDS, ...PENALTY_FIELDS])
export type ScoreField = typeof ScoreField.Type

// MODEL

export const SliderId = Schema.Literals([...Customers.HealthComponentKey.literals, ...BandKey.literals])
export type SliderId = typeof SliderId.Type

export const SavedSettings = Schema.Struct({
	id: CustomerSettingsId,
	health: Customers.HealthSettings,
	reportingCurrency: Schema.String,
})
export type SavedSettings = typeof SavedSettings.Type

export const DryRun = AsyncData.Schema(Customers.HealthDryRunResult, CommonReason)
export type DryRun = typeof DryRun.schema.Type

/** The dry run of the latest draft; `version` counts drafts, so a slower answer for an older one is dropped. */
export const Preview = Schema.Struct({ version: Schema.Int, result: DryRun.schema })

export const SavedBreakdown = AsyncData.Schema(Schema.NullOr(Customers.HealthBreakdown), CommonReason)

/** "Check one customer": the picked account's saved breakdown (`customers.account.detail`). */
export const Check = Schema.Struct({ accountId: CustomerAccountId, saved: SavedBreakdown.schema })

export const PreviewMetric = Schema.Literals(["customers", "mrr"])
export type PreviewMetric = typeof PreviewMetric.Type

export const Model = Schema.Struct({
	/** The synced settings row; null until it syncs. */
	settings: Schema.NullOr(SavedSettings),
	/** Null: no edits (the saved settings show). Never equal to the saved ones while not saving. */
	draft: Schema.NullOr(HealthDraft),
	/** The weight last moved: its card explains how far it may go while the total is over. */
	lastWeight: Schema.NullOr(Customers.HealthComponentKey),
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	sliders: Schema.Struct({
		usage: Slider.Model,
		engagement: Slider.Model,
		billing: Slider.Model,
		signals: Slider.Model,
		healthyMin: Slider.Model,
		atRiskMin: Slider.Model,
	}),
	preview: Preview,
	previewMetric: PreviewMetric,
	checkAccount: Select.Model,
	check: Schema.NullOr(Check),
	isSaving: Schema.Boolean,
	/** The number field last typed in (its `invalidFieldsOf` key) and its text, shown while it reads as the value. */
	typing: Schema.NullOr(Schema.Struct({ field: Schema.String, text: Schema.String })),
})
export type Model = typeof Model.Type

export const CHECK_ACCOUNT_ID = "health-check-account"

/** What the page edits and previews: the draft, or the saved settings when there is none. */
export const draftOf = (model: Model): HealthSettings | null => model.draft ?? model.settings?.health ?? null

export const isDirty = (model: Model): boolean =>
	model.draft !== null && model.settings !== null && !Equal.equals(model.draft, model.settings.health)

// VALIDATION

export const weightTotal = (draft: HealthSettings): number =>
	COMPONENTS.reduce((sum, key) => sum + draft.weights[key], 0)

const isScore = (value: number) => Number.isInteger(value) && value >= 0 && value <= 100

/** Keys of the fields that do not hold: `healthyMin`, `trend.2.threshold`, `pastDue`, … */
export const invalidFieldsOf = (draft: HealthSettings): ReadonlySet<string> => {
	const invalid = new Set<string>()
	const { bands, steps } = draft
	for (const band of BandKey.literals) if (!isScore(bands[band])) invalid.add(band)
	if (!(bands.atRiskMin < bands.healthyMin)) {
		invalid.add("healthyMin")
		invalid.add("atRiskMin")
	}
	const checkList = (
		list: StepList,
		rows: ReadonlyArray<{ readonly threshold: number; readonly score: number }>,
		isThreshold: (value: number) => boolean,
		isOrdered: (previous: number, next: number) => boolean,
	) =>
		rows.forEach((row, index) => {
			if (!isScore(row.score)) invalid.add(`${list}.${index}.score`)
			const previous = rows[index - 1]
			if (
				!isThreshold(row.threshold) ||
				(previous !== undefined && !isOrdered(previous.threshold, row.threshold))
			)
				invalid.add(`${list}.${index}.threshold`)
		})
	const descending = (previous: number, next: number) => next < previous
	checkList(
		"activeRatio",
		steps.usage.activeRatio.map((step) => ({ threshold: step.min, score: step.score })),
		(value) => value >= 0 && value <= 1,
		descending,
	)
	checkList(
		"trend",
		steps.usage.trend.map((step) => ({ threshold: step.min, score: step.score })),
		Number.isFinite,
		descending,
	)
	checkList(
		"daysSinceActive",
		steps.engagement.daysSinceActive.map((step) => ({ threshold: step.max, score: step.score })),
		(value) => Number.isInteger(value) && value >= 0,
		(previous, next) => next > previous,
	)
	if (!isScore(steps.usage.activeRatioWeight)) invalid.add("activeRatioWeight")
	for (const field of BILLING_FIELDS) if (!isScore(steps.billing[field])) invalid.add(field)
	for (const field of PENALTY_FIELDS) if (!isScore(steps.signals[field])) invalid.add(field)
	return invalid
}

const isHealthSettings = Schema.is(Customers.HealthSettings)

/** The draft, when it is one the server takes: fields in range and ordered, weights summing to 100. */
export const validDraftOf = (model: Model): HealthSettings | null =>
	model.draft !== null &&
	invalidFieldsOf(model.draft).size === 0 &&
	weightTotal(model.draft) === 100 &&
	isHealthSettings(model.draft)
		? model.draft
		: null

// EDITS

const replaceAt = <A>(items: ReadonlyArray<A>, index: number, f: (item: A) => A): ReadonlyArray<A> =>
	items.map((item, at) => (at === index ? f(item) : item))

export const withWeight = (draft: HealthSettings, key: ComponentKey, value: number): HealthSettings => ({
	...draft,
	weights: { ...draft.weights, [key]: Math.min(100, Math.max(0, Math.round(value))) },
})

export const withBand = (draft: HealthSettings, band: BandKey, value: number): HealthSettings => ({
	...draft,
	bands: { ...draft.bands, [band]: value },
})

/** A handle moves within its side of the other one, so the bands stay ordered. */
export const withBandHandle = (draft: HealthSettings, band: BandKey, value: number): HealthSettings =>
	withBand(
		draft,
		band,
		band === "healthyMin"
			? Math.max(value, draft.bands.atRiskMin + 1)
			: Math.min(value, draft.bands.healthyMin - 1),
	)

export const withStep = (
	draft: HealthSettings,
	list: StepList,
	index: number,
	field: StepField,
	value: number,
): HealthSettings => {
	if (list === "daysSinceActive")
		return {
			...draft,
			steps: {
				...draft.steps,
				engagement: {
					daysSinceActive: replaceAt(draft.steps.engagement.daysSinceActive, index, (step) =>
						field === "score" ? { ...step, score: value } : { ...step, max: value },
					),
				},
			},
		}
	return {
		...draft,
		steps: {
			...draft.steps,
			usage: {
				...draft.steps.usage,
				[list]: replaceAt(draft.steps.usage[list], index, (step) =>
					field === "score" ? { ...step, score: value } : { ...step, min: value },
				),
			},
		},
	}
}

export const withScore = (draft: HealthSettings, field: ScoreField, value: number): HealthSettings => {
	const { steps } = draft
	if (field === "activeRatioWeight")
		return { ...draft, steps: { ...steps, usage: { ...steps.usage, activeRatioWeight: value } } }
	if (field === "high" || field === "medium" || field === "low")
		return { ...draft, steps: { ...steps, signals: { ...steps.signals, [field]: value } } }
	return { ...draft, steps: { ...steps, billing: { ...steps.billing, [field]: value } } }
}

/**
 * Weights rescaled to sum to exactly 100, keeping their proportions: each gets the floor of its share,
 * and the points left go to the largest remainders (ties to the first part). All zero: equal shares.
 */
export const scaledWeights = (weights: Customers.HealthWeights): Customers.HealthWeights => {
	const total = COMPONENTS.reduce((sum, key) => sum + weights[key], 0)
	const exact = COMPONENTS.map((key) => ({
		key,
		share: total === 0 ? 100 / COMPONENTS.length : (weights[key] / total) * 100,
	}))
	const floors = new Map(exact.map(({ key, share }) => [key, Math.floor(share)]))
	const left = 100 - [...floors.values()].reduce((sum, value) => sum + value, 0)
	const byRemainder = [...exact].sort(
		(a, b) => b.share - Math.floor(b.share) - (a.share - Math.floor(a.share)),
	)
	for (const { key } of byRemainder.slice(0, left)) floors.set(key, (floors.get(key) ?? 0) + 1)
	return {
		usage: floors.get("usage") ?? 0,
		engagement: floors.get("engagement") ?? 0,
		billing: floors.get("billing") ?? 0,
		signals: floors.get("signals") ?? 0,
	}
}

// DERIVED

export const COMPONENT_LABEL = {
	usage: "Usage",
	engagement: "Engagement",
	billing: "Billing",
	signals: "Signals",
} as const satisfies Record<ComponentKey, string>

const BAND_LABEL = { healthyMin: "Healthy", atRiskMin: "At risk" } as const satisfies Record<BandKey, string>

/** The unsaved-changes bar: "Usage 35% → 40%", "Healthy from 70 → 75", "Scoring rules". */
export const changesOf = (saved: HealthSettings, draft: HealthSettings): ReadonlyArray<string> => [
	...COMPONENTS.filter((key) => draft.weights[key] !== saved.weights[key]).map(
		(key) => `${COMPONENT_LABEL[key]} ${saved.weights[key]}% → ${draft.weights[key]}%`,
	),
	...BandKey.literals
		.filter((band) => draft.bands[band] !== saved.bands[band])
		.map((band) => `${BAND_LABEL[band]} from ${saved.bands[band]} → ${draft.bands[band]}`),
	...(Equal.equals(draft.steps, saved.steps) ? [] : ["Scoring rules changed"]),
]

/** Customers whose band the draft changes, from the dry run. */
export const movedCount = (result: Customers.HealthDryRunResult): number =>
	result.transitions.reduce((sum, transition) => sum + transition.count, 0)

/** The saved distribution as the synced accounts carry it (no dry run needed). */
export const distributionOf = (
	accounts: ReadonlyArray<AccountRow>,
): ReadonlyArray<Customers.HealthDistributionRow> =>
	Customers.HealthStatus.literals.map((status) => {
		const rows = accounts.filter((account) => account.healthStatus === status)
		return { status, count: rows.length, mrrMinor: rows.reduce((sum, row) => sum + row.mrrMinor, 0) }
	})

/**
 * The cards' footnotes, over accounts that get a score (not churned): never active (usage and
 * engagement score them by their last step) and without a subscription (billing drops out, its
 * weight shared). A trial counts as subscribed.
 */
export const dataGapsOf = (
	accounts: ReadonlyArray<AccountRow>,
): Readonly<{ neverActive: number; noSubscription: number }> => {
	const scored = accounts.filter((account) => account.lifecycleStage !== "churned")
	return {
		neverActive: scored.filter((account) => account.lastActiveAtMs === null).length,
		noSubscription: scored.filter(
			(account) =>
				account.planName === null && account.mrrMinor === 0 && account.lifecycleStage !== "trialing",
		).length,
	}
}
