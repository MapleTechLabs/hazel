import * as Customers from "@hazel/domain/customers"
import { Option, Schema, type Types } from "effect"
import { toMajor, toMinor } from "../../../../customers/format"
import type { AccountRow } from "../../../../customers/queries"
import {
	type ConfigForm,
	type ConfigValue,
	currencyOf,
	type Editor,
	type Model,
	type RuleForm,
	type RuleRow,
	ruleById,
	type ScopeForm,
} from "./model"

/**
 * The rule editor's form and the `RuleDraft` it submits: numbers are edited as text, checked
 * against the domain schemas' own bounds (`RuleConfig`, `RuleDraft`), and turned into the draft
 * only when every field holds.
 */

/** Each template's config schema, whose fields carry the bounds. */
const CONFIG_FIELDS = {
	inactive: Customers.InactiveConfig.fields,
	usage_drop: Customers.UsageDropConfig.fields,
	payment_failed: Customers.PaymentFailedConfig.fields,
	cancel_scheduled: Customers.CancelScheduledConfig.fields,
	trial_ending_low_activation: Customers.TrialEndingLowActivationConfig.fields,
	onboarding_stalled: Customers.OnboardingStalledConfig.fields,
	health_drop: Customers.HealthDropConfig.fields,
	champion_inactive: Customers.ChampionInactiveConfig.fields,
	near_limit: Customers.NearLimitConfig.fields,
	seat_growth: Customers.SeatGrowthConfig.fields,
} satisfies Record<Customers.SignalTemplate, Schema.Struct.Fields>

/** How a numeric config field reads in its error (the bounds of `rules.ts`'s `Days`, `AgeDays`, `Pct`, `Count`). */
const FIELD_ERROR = {
	days: `Whole days, 1 to ${Customers.MAX_WINDOW_DAYS}`,
	ageDays: "Whole days, 1 to 365",
	pct: "A percentage, 0 to 1,000",
	count: "A whole number, 0 to 100,000",
} as const

const FIELD_KIND = new Map<string, keyof typeof FIELD_ERROR>([
	["inactiveDays", "days"],
	["priorWindowDays", "days"],
	["minPriorActiveUsers", "count"],
	["recentDays", "days"],
	["baselineDays", "days"],
	["dropPct", "pct"],
	["overdueDays", "days"],
	["downgradeWindowDays", "days"],
	["daysBeforeEnd", "days"],
	["minActiveUsers", "count"],
	["activeWindowDays", "days"],
	["minAgeDays", "ageDays"],
	["maxAgeDays", "ageDays"],
	["minActiveContacts", "count"],
	["dropPoints", "count"],
	["windowDays", "days"],
	["thresholdPct", "pct"],
	["growthPct", "pct"],
])

const numberOf = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text))

// FORM ← RULE

/** A config as the form edits it: numbers as text, everything else as is. */
export const configFormOf = (config: Customers.RuleConfig): ConfigForm =>
	Object.fromEntries(
		Object.entries(config)
			.filter(([key]) => key !== "_tag")
			.map(([key, value]): [string, ConfigValue] => [
				key,
				typeof value === "number" ? String(value) : (value as ConfigValue),
			]),
	)

export const scopeFormOf = (scope: Customers.RuleScope, currency: string): ScopeForm => ({
	stages:
		scope.lifecycleStages !== undefined && scope.lifecycleStages.length > 0
			? scope.lifecycleStages
			: null,
	plans: scope.planNames !== undefined && scope.planNames.length > 0 ? scope.planNames : null,
	minMrr: scope.minMrrMinor === undefined ? null : String(toMajor(scope.minMrrMinor, currency)),
	payingOnly: scope.payingOnly === true,
	tags: scope.tagsAny ?? [],
})

export const formOfRule = (rule: RuleRow, currency: string): RuleForm => ({
	template: rule.template,
	name: rule.name,
	severity: rule.severity,
	enabled: rule.enabled,
	config: configFormOf(rule.config),
	scope: scopeFormOf(rule.scope, currency),
})

/** A new rule starts from its template's defaults, on, over every account. */
export const formOfTemplate = (template: Customers.SignalTemplate): RuleForm => {
	const meta = Customers.TEMPLATES[template]
	return {
		template,
		name: meta.name,
		severity: meta.defaultSeverity,
		enabled: true,
		config: configFormOf(meta.defaultConfig),
		scope: { stages: null, plans: null, minMrr: null, payingOnly: false, tags: [] },
	}
}

// FORM → DRAFT

/** A field the form shows disabled: the downgrade window while downgrades are off. */
const isIdle = (form: RuleForm, key: string): boolean =>
	key === "downgradeWindowDays" && form.config.includeDowngrades !== true

/**
 * The config the form describes, typed fields parsed (NaN where a number does not parse). A
 * disabled field that does not hold submits its template default, so it cannot block the save.
 */
const configCandidateOf = (form: RuleForm): Record<string, unknown> => {
	const fields: Schema.Struct.Fields = CONFIG_FIELDS[form.template]
	return {
		_tag: form.template,
		...Object.fromEntries(
			Object.entries(Customers.TEMPLATES[form.template].defaultConfig)
				.filter(([key]) => key !== "_tag")
				.map(([key, fallback]) => {
					const value = form.config[key] ?? fallback
					const parsed =
						typeof fallback === "number" && typeof value === "string" ? numberOf(value) : value
					const schema = fields[key]
					return [
						key,
						isIdle(form, key) && schema !== undefined && !Schema.is(schema)(parsed)
							? fallback
							: parsed,
					]
				}),
		),
	}
}

const isMrr = (text: string): boolean => {
	const value = numberOf(text)
	return Number.isFinite(value) && value >= 0
}

/** The scope the form describes; an MRR that does not parse is left out (and flagged by `fieldErrors`). */
export const scopeOf = (form: ScopeForm, currency: string): Customers.RuleScope => {
	const scope: Types.Mutable<Customers.RuleScope> = {}
	if (form.payingOnly) scope.payingOnly = true
	if (form.stages !== null && form.stages.length > 0) scope.lifecycleStages = form.stages
	if (form.plans !== null && form.plans.length > 0) scope.planNames = form.plans
	if (form.minMrr !== null && isMrr(form.minMrr))
		scope.minMrrMinor = toMinor(numberOf(form.minMrr), currency)
	if (form.tags.length > 0) scope.tagsAny = form.tags
	return scope
}

/** What the form would submit, valid or not. */
const candidateOf = (form: RuleForm, currency: string) => ({
	name: form.name.trim(),
	severity: form.severity,
	config: configCandidateOf(form),
	scope: scopeOf(form.scope, currency),
	enabled: form.enabled,
})

/** Field errors keyed `name`, `config.<key>`, `scope.minMrr`; empty when the form holds. */
export const fieldErrors = (form: RuleForm, currency: string): Readonly<Record<string, string>> => {
	const candidate = candidateOf(form, currency)
	const errors: Record<string, string> = {}
	if (!Schema.is(Customers.RuleDraft.fields.name)(candidate.name)) {
		errors.name = "Give the rule a name, up to 120 characters"
	}
	for (const [key, schema] of Object.entries(CONFIG_FIELDS[form.template])) {
		const kind = FIELD_KIND.get(key)
		if (kind !== undefined && !Schema.is(schema)(candidate.config[key])) {
			errors[`config.${key}`] = FIELD_ERROR[kind]
		}
	}
	// The schema's cross-field check: each age reads fine alone, so the maximum carries it.
	const { minAgeDays, maxAgeDays } = candidate.config
	if (
		form.template === "onboarding_stalled" &&
		errors["config.minAgeDays"] === undefined &&
		errors["config.maxAgeDays"] === undefined &&
		Number(minAgeDays) > Number(maxAgeDays)
	) {
		errors["config.maxAgeDays"] = "At least the minimum age"
	}
	if (form.scope.minMrr !== null && !isMrr(form.scope.minMrr)) {
		errors["scope.minMrr"] = "An amount of 0 or more"
	}
	return errors
}

/** The draft to dry-run and save; none while a field is invalid. */
export const draftOf = (form: RuleForm, currency: string): Option.Option<Customers.RuleDraft> =>
	Object.keys(fieldErrors(form, currency)).length > 0
		? Option.none()
		: Schema.decodeUnknownOption(Customers.RuleDraft)(candidateOf(form, currency))

/** The draft of a saved rule, `enabled` overridden (the list's switch). */
export const draftOfRule = (rule: RuleRow, enabled: boolean): Customers.RuleDraft => ({
	name: rule.name,
	severity: rule.severity,
	config: rule.config,
	scope: rule.scope,
	enabled,
})

// CHANGES

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

/** How many settings differ from `saved`: the name, severity, on/off, each threshold and each scope condition. */
export const changeCount = (form: RuleForm, saved: RuleForm, currency: string): number => {
	const now = candidateOf(form, currency)
	const before = candidateOf(saved, currency)
	const config = Object.keys(before.config).filter((key) => !same(now.config[key], before.config[key]))
	const scopeKeys = ["payingOnly", "lifecycleStages", "planNames", "minMrrMinor", "tagsAny"] as const
	const scope = scopeKeys.filter((key) => !same(now.scope[key], before.scope[key]))
	const flags = [now.name !== before.name, now.severity !== before.severity, now.enabled !== before.enabled]
	return flags.filter(Boolean).length + config.length + scope.length
}

// SCOPE

/** Churned accounts are never evaluated (`evaluate.ts`); they are not part of "in scope of M". */
export const evaluatedAccounts = (accounts: ReadonlyArray<AccountRow>): ReadonlyArray<AccountRow> =>
	accounts.filter((account) => account.lifecycleStage !== "churned")

/** The backend's `inScope` (`evaluate.ts`) over a synced account. */
export const isInScope = (scope: Customers.RuleScope, account: AccountRow): boolean =>
	!(scope.payingOnly === true && account.mrrMinor <= 0 && account.lifecycleStage !== "trialing") &&
	(scope.lifecycleStages === undefined ||
		scope.lifecycleStages.length === 0 ||
		scope.lifecycleStages.includes(account.lifecycleStage)) &&
	(scope.planNames === undefined ||
		scope.planNames.length === 0 ||
		(account.planName !== null && scope.planNames.includes(account.planName))) &&
	(scope.minMrrMinor === undefined || account.mrrMinor >= scope.minMrrMinor) &&
	(scope.tagsAny === undefined ||
		scope.tagsAny.length === 0 ||
		scope.tagsAny.some((tag) => account.tags.includes(tag)))

/** Plan names on the synced accounts, A–Z: the scope's plan choices. */
export const planNamesOf = (accounts: ReadonlyArray<AccountRow>): ReadonlyArray<string> =>
	[...new Set(accounts.flatMap((account) => (account.planName === null ? [] : [account.planName])))].sort()

// THE EDITOR

export interface EditorStatus {
	readonly errors: Readonly<Record<string, string>>
	readonly draft: Option.Option<Customers.RuleDraft>
	/** The saved rule; undefined for a new one. */
	readonly saved: RuleRow | undefined
	/** Against the saved rule, or for a new one, its template's defaults. */
	readonly changes: number
	readonly canSave: boolean
}

export const editorStatus = (model: Model, editor: Editor, form: RuleForm): EditorStatus => {
	const currency = currencyOf(model)
	const saved = ruleById(model, editor.ruleId)
	const baseline = saved === undefined ? formOfTemplate(form.template) : formOfRule(saved, currency)
	const draft = draftOf(form, currency)
	const changes = changeCount(form, baseline, currency)
	return {
		errors: fieldErrors(form, currency),
		draft,
		saved,
		changes,
		canSave: Option.isSome(draft) && (editor.ruleId === null || changes > 0) && !editor.isSaving,
	}
}
