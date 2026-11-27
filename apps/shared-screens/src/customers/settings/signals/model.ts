/**
 * Signals settings (`docs/customers/spec.md` §5): the rows the rules list and the rule editor read,
 * and the editor's form. Numbers are edited as text, so any input can show while it is typed.
 */
import * as Customers from "@hazel/domain/customers"
import { CustomerSettingsId, CustomerSignalRuleId } from "@hazel/schema"
import { Schema } from "effect"
import { isTemplateAvailable } from "../../data/providers"

// ROWS

/** A rule as the pages keep it: the synced row, dates as epoch ms. */
export const RuleRow = Schema.Struct({
	id: CustomerSignalRuleId,
	name: Schema.String,
	template: Customers.SignalTemplate,
	kind: Customers.SignalKind,
	severity: Customers.SignalSeverity,
	config: Customers.RuleConfig,
	scope: Customers.RuleScope,
	enabled: Schema.Boolean,
	lastTriggeredAtMs: Schema.NullOr(Schema.Finite),
	matchingCount: Schema.Int,
	updatedAtMs: Schema.Finite,
})
export type RuleRow = typeof RuleRow.Type

/** A metric a usage rule can watch (`customer_metric_definitions`). */
export const MetricRow = Schema.Struct({
	key: Schema.String,
	name: Schema.String,
	unit: Schema.NullOr(Schema.String),
	/** Null: Hazel computes it (built in). A metered source's has a plan limit. */
	provider: Schema.NullOr(Customers.CustomerProvider),
	description: Schema.NullOr(Schema.String),
})
export type MetricRow = typeof MetricRow.Type

/** Who Needs attention covers, with the settings row it is saved to. */
export const AttentionRow = Schema.Struct({
	settingsId: CustomerSettingsId,
	attention: Customers.AttentionSettings,
})
export type AttentionRow = typeof AttentionRow.Type

// THE EDITOR'S FORM

/** A config field as typed: numbers stay text until the draft is built. */
export const ConfigValue = Schema.Union([Schema.String, Schema.Boolean, Schema.Array(Schema.String)])
export type ConfigValue = typeof ConfigValue.Type
export const ConfigForm = Schema.Record(Schema.String, ConfigValue)
export type ConfigForm = typeof ConfigForm.Type

/** The scope's conditions; null: the condition is not added. */
export const ScopeForm = Schema.Struct({
	stages: Schema.NullOr(Schema.Array(Customers.LifecycleStage)),
	plans: Schema.NullOr(Schema.Array(Schema.String)),
	/** Major units, as typed. */
	minMrr: Schema.NullOr(Schema.String),
	payingOnly: Schema.Boolean,
	/** No editor for tags yet: kept as saved, removable. */
	tags: Schema.Array(Schema.String),
})
export type ScopeForm = typeof ScopeForm.Type

export const ScopeCondition = Schema.Literals(["stage", "plan", "mrr", "tags"])
export type ScopeCondition = typeof ScopeCondition.Type

export const RuleForm = Schema.Struct({
	template: Customers.SignalTemplate,
	name: Schema.String,
	severity: Customers.SignalSeverity,
	enabled: Schema.Boolean,
	config: ConfigForm,
	scope: ScopeForm,
})
export type RuleForm = typeof RuleForm.Type

/** The template picker's kind filter. */
export const PickerKind = Schema.Literals(["all", "risk", "opportunity"])
export type PickerKind = typeof PickerKind.Type

/** Every rule shows in its template's order, in the list and the picker. */
export const TEMPLATE_ORDER = Customers.SignalTemplate.literals

export const ruleById = (
	rules: ReadonlyArray<RuleRow> | null,
	ruleId: CustomerSignalRuleId | null,
): RuleRow | undefined => (ruleId === null ? undefined : rules?.find((rule) => rule.id === ruleId))

/** Templates the connected sources can feed; everything while the connections are unknown. */
export const isAvailable = (
	connectedProviders: ReadonlyArray<Customers.CustomerProvider> | null,
	template: Customers.SignalTemplate,
): boolean => connectedProviders === null || isTemplateAvailable(template, connectedProviders)

/** Settings, rules and data sources are for admins and owners; members see them read-only. */
export const isCustomersAdmin = (role: "owner" | "admin" | "member" | null | undefined): boolean =>
	role === "admin" || role === "owner"
