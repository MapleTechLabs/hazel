import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerSignalRuleId } from "@hazel/schema"
import { Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"
import { isTemplateAvailable } from "../../../../customers/providers"
import { AccountRow, SettingsSummary, SignalRow } from "../../../../customers/queries"
import * as Modal from "../../../../ui/modal"

/**
 * Signals settings (`docs/customers/spec.md` §5): the rules list with its template picker, and the
 * rule editor (new or existing) with a live dry-run preview. One page instance per org, so moving
 * between the list and the editor keeps the live rows.
 */

// ROWS

/** A rule as the page keeps it: the synced row, dates as epoch ms. */
export const RuleRow = Schema.Struct({
	id: CustomerSignalRuleId,
	name: Schema.String,
	template: Customers.SignalTemplate,
	kind: Customers.SignalKind,
	severity: Customers.SignalSeverity,
	config: Customers.RuleConfig,
	scope: Customers.RuleScope,
	enabled: Schema.Boolean,
	lastTriggeredAtMs: Schema.NullOr(Schema.Number),
	matchingCount: Schema.Int,
	updatedAtMs: Schema.Number,
})
export type RuleRow = typeof RuleRow.Type

/** A metric a usage rule can watch (`customer_metric_definitions`). */
export const MetricRow = Schema.Struct({
	key: Schema.String,
	name: Schema.String,
	unit: Schema.NullOr(Schema.String),
	/** Null: Hazel computes it (built in). `autumn`: metered, with a plan limit. */
	provider: Schema.NullOr(Customers.CustomerProvider),
	description: Schema.NullOr(Schema.String),
})
export type MetricRow = typeof MetricRow.Type

// THE EDITOR'S FORM

/** A config field as typed: numbers stay text until the draft is built, so any input can show. */
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

export const DryRun = AsyncData.Schema(Customers.RuleDryRunResult, CommonReason)
export type DryRun = typeof DryRun.schema.Type

export const Editor = Schema.Struct({
	/** Null: a new rule. */
	ruleId: Schema.NullOr(CustomerSignalRuleId),
	/** Null until the rule has synced. */
	form: Schema.NullOr(RuleForm),
	/** Bumped on every edit: a dry-run answer for an older version is dropped. */
	version: Schema.Int,
	preview: DryRun.schema,
	/** The usage chart's example account, among the preview's top matches. */
	exampleAccountId: Schema.NullOr(CustomerAccountId),
	isSaving: Schema.Boolean,
	isDeleting: Schema.Boolean,
})
export type Editor = typeof Editor.Type

// THE PICKER

export const PickerKind = Schema.Literals(["all", "risk", "opportunity"])
export type PickerKind = typeof PickerKind.Type

export const Picker = Schema.Struct({
	search: Schema.String,
	kind: PickerKind,
	selected: Schema.NullOr(Customers.SignalTemplate),
})
export type Picker = typeof Picker.Type

// MODEL

export const Model = Schema.Struct({
	/** Live rows; null until each query answers. */
	rules: Schema.NullOr(Schema.Array(RuleRow)),
	signals: Schema.NullOr(Schema.Array(SignalRow)),
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	connectedProviders: Schema.NullOr(Schema.Array(Customers.CustomerProvider)),
	settings: Schema.NullOr(SettingsSummary),
	metrics: Schema.Array(MetricRow),
	/** Null: the rules list. */
	editor: Schema.NullOr(Editor),
	pickerModal: Modal.Model,
	picker: Picker,
	discardModal: Modal.Model,
	deleteModal: Modal.Model,
})
export type Model = typeof Model.Type

export const PICKER_MODAL_ID = "signals-template-picker"
export const DISCARD_MODAL_ID = "signals-discard-changes"
export const DELETE_MODAL_ID = "signals-delete-rule"

/** The dry run waits this long after the last edit. */
export const DRY_RUN_DEBOUNCE_MS = 400

/** Every rule shows its template's order in the list and the picker. */
export const TEMPLATE_ORDER = Customers.SignalTemplate.literals

export const ruleById = (model: Model, ruleId: CustomerSignalRuleId | null): RuleRow | undefined =>
	ruleId === null ? undefined : model.rules?.find((rule) => rule.id === ruleId)

export const currencyOf = (model: Model): string => model.settings?.reportingCurrency ?? "USD"

/** Templates the connected sources can feed; everything while the connections are unknown. */
export const isAvailable = (model: Model, template: Customers.SignalTemplate): boolean =>
	model.connectedProviders === null || isTemplateAvailable(template, model.connectedProviders)
