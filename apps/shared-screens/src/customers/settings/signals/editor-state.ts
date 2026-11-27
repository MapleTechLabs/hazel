// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** The rule editor's props, Model and messages (`RuleEditor.ts`), shared with its card views. */
import { UiSchema } from "@effect/ui"
import * as Customers from "@hazel/domain/customers"
import { CustomerSignalRuleId, OrganizationId } from "@hazel/schema"
import { TextField } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { CommonReason } from "../../../modals/feedback"
import { AccountRow, SettingsSummary, SignalRow } from "../../data/queries"
import { MetricRow, RuleForm, RuleRow, ScopeCondition } from "./model"

/** A rule write's failure: the rule is gone, or the store refused the draft. */
export const RuleWriteFailure = Schema.Union([Schema.Literals(["NotFound", "Invalid"]), CommonReason])
export type RuleWriteFailure = typeof RuleWriteFailure.Type

export const RuleEditorProps = Schema.Struct({
	organizationId: OrganizationId,
	orgSlug: Schema.String,
	role: Schema.NullOr(Schema.Literals(["owner", "admin", "member"])),
	/** Null: a new rule from `template`. */
	ruleId: Schema.NullOr(CustomerSignalRuleId),
	template: Schema.NullOr(Customers.SignalTemplate),
	nowMs: Schema.Finite,
})
export type RuleEditorProps = typeof RuleEditorProps.Type

export const EditorDialog = Schema.Literals(["none", "discard", "delete"])
export type EditorDialog = typeof EditorDialog.Type

export const RuleEditorModel = Schema.Struct({
	/** Live rows; null until each query answers. */
	rules: Schema.NullOr(Schema.Array(RuleRow)),
	signals: Schema.NullOr(Schema.Array(SignalRow)),
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	providers: Schema.NullOr(Schema.Array(Customers.CustomerProvider)),
	settings: Schema.NullOr(SettingsSummary),
	/** The settings query answered (no row yet reads as USD); a saved rule's form waits for it. */
	hasSettings: Schema.Boolean,
	metrics: Schema.Array(MetricRow),
	/** Null until the rule has synced. */
	form: Schema.NullOr(RuleForm),
	/** The typed fields by form key (`name`, `config.<key>`, `scope.minMrr`). */
	fields: Schema.Record(Schema.String, TextField.State),
	isSaving: Schema.Boolean,
	isDeleting: Schema.Boolean,
	dialog: EditorDialog,
})
export type RuleEditorModel = typeof RuleEditorModel.Type

export const RuleEditorMessage = UiSchema.TaggedEnum({
	UpdatedRules: { rules: Schema.Array(RuleRow) },
	UpdatedSignals: { signals: Schema.Array(SignalRow) },
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	UpdatedProviders: { providers: Schema.Array(Customers.CustomerProvider) },
	UpdatedSettings: { settings: Schema.NullOr(SettingsSummary) },
	UpdatedMetrics: { metrics: Schema.Array(MetricRow) },

	// The fields
	ChangedField: { key: Schema.String, payload: TextField.ChangePayload },
	PickedSeverity: { severity: Customers.SignalSeverity },
	ToggledConfigFlag: { key: Schema.String, checked: Schema.Boolean },
	PickedMetric: { metricKey: Schema.String },
	PickedLimitMetrics: { metricKeys: Schema.Array(Schema.String) },
	PressedAddCondition: { condition: ScopeCondition },
	PressedRemoveCondition: { condition: ScopeCondition },
	PickedScopeStages: { stages: Schema.Array(Customers.LifecycleStage) },
	PickedScopePlans: { plans: Schema.Array(Schema.String) },
	ToggledPayingOnly: { checked: Schema.Boolean },
	PressedToggleEnabled: {},

	// The actions
	PressedSave: {},
	SucceededCreateRule: { ruleId: CustomerSignalRuleId },
	FailedCreateRule: { reason: RuleWriteFailure },
	SucceededUpdateRule: {},
	FailedUpdateRule: { reason: RuleWriteFailure },
	PressedClose: {},
	PressedCrumb: { index: Schema.Finite },
	PressedDiscard: {},
	DismissedDiscard: {},
	PressedDelete: {},
	PressedConfirmDelete: {},
	DismissedDelete: {},
	SucceededDeleteRule: {},
	FailedDeleteRule: { reason: RuleWriteFailure },
})
export type RuleEditorMessage = typeof RuleEditorMessage.Type

export type EditorContext = Readonly<{
	model: RuleEditorModel
	form: RuleForm
	errors: Readonly<Record<string, string>>
	isAdmin: boolean
	orgSlug: string
	nowMs: number
}>
