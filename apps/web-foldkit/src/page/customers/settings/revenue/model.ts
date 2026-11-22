import * as Customers from "@hazel/domain/customers"
import { CustomerSettingsId } from "@hazel/schema"
import { Equal, Match, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"
import * as Modal from "../../../../ui/modal"
import * as Select from "../../../../ui/select"

/**
 * Revenue settings (`docs/customers/revenue.md`): the org's ordered classification rules and the
 * variable MRR window, a draft the admin edits, and its preview against the saved ones.
 */

export const SavedSettings = Schema.Struct({
	id: CustomerSettingsId,
	revenueRules: Customers.RevenueRules,
	variableMrrMonths: Customers.VariableMrrMonths,
	reportingCurrency: Schema.String,
})
export type SavedSettings = typeof SavedSettings.Type

// DRAFT

/** `RevenueCondition` without its checks: holds what the inputs hold until the rule is complete. */
export const ConditionDraft = Schema.Struct({
	field: Customers.RevenueConditionField,
	/** The metadata key; empty for the other fields. */
	key: Schema.String,
	values: Schema.Array(Schema.String),
})
export type ConditionDraft = typeof ConditionDraft.Type

export const RuleDraft = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	conditions: Schema.Array(ConditionDraft),
	classification: Customers.RevenueClass,
})
export type RuleDraft = typeof RuleDraft.Type

export const RevenueDraft = Schema.Struct({
	rules: Schema.Array(RuleDraft),
	variableMrrMonths: Schema.Int,
})
export type RevenueDraft = typeof RevenueDraft.Type

// MODEL

export const Catalog = AsyncData.Schema(Customers.RevenueCatalog, CommonReason)
export const PreviewResult = AsyncData.Schema(Customers.RevenuePreviewResult, CommonReason)

/** The preview of the latest draft; `version` counts drafts, so a slower answer for an older one is dropped. */
export const Preview = Schema.Struct({ version: Schema.Int, result: PreviewResult.schema })

/** Which of the page's Selects a message is for; its id (`selectIdOf`) carries this. */
export type SelectTarget =
	| Readonly<{ _tag: "Window" }>
	| Readonly<{ _tag: "Class"; ruleId: string }>
	| Readonly<{ _tag: "Field"; ruleId: string; index: number }>
	| Readonly<{ _tag: "AddValue"; ruleId: string; index: number }>

export const Model = Schema.Struct({
	/** The synced settings row; null until it syncs. */
	settings: Schema.NullOr(SavedSettings),
	/** Null: no edits (the saved rules show). */
	draft: Schema.NullOr(RevenueDraft),
	/** `customers.revenue.catalog`: what the value pickers offer. */
	catalog: Catalog.schema,
	preview: Preview,
	/** The page's Selects by `selectIdOf`; what each shows selected comes from the draft. */
	selects: Schema.Record(Schema.String, Select.Model),
	/** A metadata condition's value being typed, by `entryKeyOf`. */
	valueEntries: Schema.Record(Schema.String, Schema.String),
	confirmModal: Modal.Model,
	isSaving: Schema.Boolean,
})
export type Model = typeof Model.Type

export const CONFIRM_MODAL_ID = "revenue-confirm-save"
export const MAX_CONDITIONS = 20
export const MAX_VALUES = 200
export const MAX_TEXT = 500
export const MAX_NAME = 200

const WINDOW_SELECT_ID = "revenue-window"

/** The rule id comes last: it is the one part that can hold anything. */
export const selectIdOf = (target: SelectTarget): string =>
	Match.valueTags(target, {
		Window: () => WINDOW_SELECT_ID,
		Class: ({ ruleId }) => `revenue-class-${ruleId}`,
		Field: ({ ruleId, index }) => `revenue-field-${index}-${ruleId}`,
		AddValue: ({ ruleId, index }) => `revenue-value-${index}-${ruleId}`,
	})

export const targetOfSelectId = (id: string): SelectTarget | null => {
	if (id === WINDOW_SELECT_ID) return { _tag: "Window" }
	const ruleClass = /^revenue-class-(.+)$/.exec(id)
	if (ruleClass?.[1] !== undefined) return { _tag: "Class", ruleId: ruleClass[1] }
	const condition = /^revenue-(field|value)-(\d+)-(.+)$/.exec(id)
	if (condition?.[3] === undefined) return null
	return {
		_tag: condition[1] === "field" ? "Field" : "AddValue",
		ruleId: condition[3],
		index: Number(condition[2]),
	}
}

export const entryKeyOf = (ruleId: string, index: number) => `${ruleId}:${index}`

// LABELS

export const CLASS_LABEL = {
	recurring: "Recurring",
	variable: "Variable",
	one_off: "One-off",
	excluded: "Excluded",
} as const satisfies Record<Customers.RevenueClass, string>

export const FIELD_LABEL = {
	product: "Product",
	price: "Price",
	lookup_key: "Lookup key",
	usage_type: "Usage type",
	billing_scheme: "Billing scheme",
	price_type: "Price type",
	line_source: "Line source",
	proration: "Proration",
	metadata: "Metadata",
} as const satisfies Record<Customers.RevenueConditionField, string>

type Choice = readonly [value: string, label: string]

/** The fixed values of a field; null for the fields whose values come from the catalog or are typed. */
const ENUM_OPTIONS = {
	product: null,
	price: null,
	lookup_key: null,
	metadata: null,
	usage_type: [
		["licensed", "Licensed"],
		["metered", "Metered"],
	],
	billing_scheme: [
		["per_unit", "Per unit"],
		["tiered", "Tiered"],
	],
	price_type: [
		["recurring", "Recurring"],
		["one_time", "One-time"],
	],
	line_source: [
		["subscription", "Subscription item"],
		["invoice_item", "Invoice item"],
	],
	proration: [
		["true", "Is a proration"],
		["false", "Not a proration"],
	],
} as const satisfies Record<Customers.RevenueConditionField, ReadonlyArray<Choice> | null>

export const enumOptionsOf = (field: Customers.RevenueConditionField): ReadonlyArray<Choice> | null =>
	ENUM_OPTIONS[field]

const uniqueBy = (options: ReadonlyArray<Choice>): ReadonlyArray<Choice> => [
	...new Map(options.map((option) => [option[0], option])).values(),
]

/** What a catalog field's picker offers: its products, prices or lookup keys. */
export const catalogOptionsOf = (
	field: Customers.RevenueConditionField,
	catalog: Customers.RevenueCatalog,
): ReadonlyArray<Choice> => {
	switch (field) {
		case "product":
			return uniqueBy(
				catalog.prices.flatMap((price) =>
					price.productId === null
						? []
						: [[price.productId, price.productName ?? price.productId] as const],
				),
			)
		case "price":
			return catalog.prices.map((price) => {
				const name = price.nickname ?? price.lookupKey ?? price.priceId
				return [
					price.priceId,
					price.productName === null ? name : `${price.productName} · ${name}`,
				] as const
			})
		case "lookup_key":
			return uniqueBy(
				catalog.prices.flatMap((price) =>
					price.lookupKey === null ? [] : [[price.lookupKey, price.lookupKey] as const],
				),
			)
		default:
			return []
	}
}

/** A chosen value as the page names it; an id the catalog no longer holds reads as itself. */
export const valueLabelOf = (
	field: Customers.RevenueConditionField,
	value: string,
	catalog: Customers.RevenueCatalog | null,
): string => {
	const options = enumOptionsOf(field) ?? (catalog === null ? [] : catalogOptionsOf(field, catalog))
	return options.find((option) => option[0] === value)?.[1] ?? value
}

/** The window options; a saved window outside them (the API takes 1–12) stays selectable. */
export const windowOptionsOf = (months: number): ReadonlyArray<number> =>
	[...new Set([...Array.from({ length: 12 }, (_, index) => index + 1), months])].sort((a, b) => a - b)

// READS

export const draftOfSaved = (settings: SavedSettings): RevenueDraft => ({
	rules: settings.revenueRules.map((rule) => ({
		id: rule.id,
		name: rule.name,
		conditions: rule.conditions.map((condition) => ({
			field: condition.field,
			key: condition.key ?? "",
			values: condition.values,
		})),
		classification: rule.classification,
	})),
	variableMrrMonths: settings.variableMrrMonths,
})

/** What the page edits and previews: the draft, or the saved rules when there is none. */
export const draftOf = (model: Model): RevenueDraft | null =>
	model.draft ?? (model.settings === null ? null : draftOfSaved(model.settings))

export const toRules = (draft: RevenueDraft): ReadonlyArray<Customers.RevenueRule> =>
	draft.rules.map((rule) => ({
		id: rule.id,
		name: rule.name,
		conditions: rule.conditions.map((condition) =>
			condition.field === "metadata"
				? { field: condition.field, key: condition.key.trim(), values: condition.values }
				: { field: condition.field, values: condition.values },
		),
		classification: rule.classification,
	}))

/** The draft as it is saved: metadata keys trimmed. A draft equal to the saved rules once saved is clean. */
export const normalizedDraft = (draft: RevenueDraft): RevenueDraft => ({
	...draft,
	rules: draft.rules.map((rule) => ({
		...rule,
		conditions: rule.conditions.map((condition) =>
			condition.field === "metadata" ? { ...condition, key: condition.key.trim() } : condition,
		),
	})),
})

/** What keeps a rule from being saved, in a line; null when it is complete. */
export const problemOf = (rule: RuleDraft): string | null => {
	if (rule.conditions.length === 0) return "Add at least one condition."
	if (rule.conditions.some((condition) => condition.field === "metadata" && condition.key.trim() === ""))
		return "Name the metadata key."
	if (rule.conditions.some((condition) => condition.values.length === 0))
		return "Give every condition at least one value."
	return null
}

const isRevenueRules = Schema.is(Customers.RevenueRules)
const isWindow = Schema.is(Customers.VariableMrrMonths)

export interface ValidDraft {
	readonly rules: ReadonlyArray<Customers.RevenueRule>
	readonly variableMrrMonths: number
}

/** The draft as the server takes it; null while a rule is incomplete. */
export const validOf = (draft: RevenueDraft): ValidDraft | null => {
	const rules = toRules(draft)
	return draft.rules.every((rule) => problemOf(rule) === null) &&
		isRevenueRules(rules) &&
		isWindow(draft.variableMrrMonths)
		? { rules, variableMrrMonths: draft.variableMrrMonths }
		: null
}

export const isDirty = (model: Model): boolean =>
	model.draft !== null &&
	model.settings !== null &&
	!Equal.equals(normalizedDraft(model.draft), draftOfSaved(model.settings))

const basisOf = (draft: RevenueDraft, currency: string) =>
	Customers.revenueBasisOf(toRules(draft), draft.variableMrrMonths, currency, 0)

/** The saved basis changed between two rows: another admin's save, or this page's. */
export const isSameBasis = (a: SavedSettings, b: SavedSettings): boolean =>
	basisOf(draftOfSaved(a), a.reportingCurrency) === basisOf(draftOfSaved(b), b.reportingCurrency)

/** Saving restates MRR history unless only names changed (a name is not part of the basis). */
export const restatesHistory = (model: Model): boolean =>
	model.draft !== null &&
	model.settings !== null &&
	basisOf(model.draft, model.settings.reportingCurrency) !==
		basisOf(draftOfSaved(model.settings), model.settings.reportingCurrency)

// EDITS

export const withRule = (
	draft: RevenueDraft,
	ruleId: string,
	f: (rule: RuleDraft) => RuleDraft,
): RevenueDraft => ({
	...draft,
	rules: draft.rules.map((rule) => (rule.id === ruleId ? f(rule) : rule)),
})

export const withCondition = (
	draft: RevenueDraft,
	ruleId: string,
	index: number,
	f: (condition: ConditionDraft) => ConditionDraft,
): RevenueDraft =>
	withRule(draft, ruleId, (rule) => ({
		...rule,
		conditions: rule.conditions.map((condition, at) => (at === index ? f(condition) : condition)),
	}))

export const withRuleMoved = (draft: RevenueDraft, ruleId: string, step: -1 | 1): RevenueDraft => {
	const from = draft.rules.findIndex((rule) => rule.id === ruleId)
	const moved = draft.rules[from]
	const to = from + step
	if (moved === undefined || to < 0 || to >= draft.rules.length) return draft
	const rest = draft.rules.filter((rule) => rule.id !== ruleId)
	return { ...draft, rules: [...rest.slice(0, to), moved, ...rest.slice(to)] }
}

const EMPTY_CONDITION: ConditionDraft = { field: "product", key: "", values: [] }

/** A new rule's id: unique in the list, stable across its edits. */
const nextRuleId = (rules: ReadonlyArray<RuleDraft>): string => {
	const taken = new Set(rules.map((rule) => rule.id))
	let n = rules.length + 1
	while (taken.has(`rule-${n}`)) n++
	return `rule-${n}`
}

export const withNewRule = (draft: RevenueDraft): RevenueDraft => ({
	...draft,
	rules: [
		...draft.rules,
		{
			id: nextRuleId(draft.rules),
			name: "",
			conditions: [EMPTY_CONDITION],
			classification: "recurring",
		},
	],
})

export const withNewCondition = (rule: RuleDraft): RuleDraft => ({
	...rule,
	conditions: [...rule.conditions, EMPTY_CONDITION],
})

/** A field's values mean nothing to another field: changing it starts the condition over. */
export const withField = (
	condition: ConditionDraft,
	field: Customers.RevenueConditionField,
): ConditionDraft => (condition.field === field ? condition : { field, key: "", values: [] })

export const withValueToggled = (condition: ConditionDraft, value: string): ConditionDraft => ({
	...condition,
	values: condition.values.includes(value)
		? condition.values.filter((other) => other !== value)
		: [...condition.values, value],
})
