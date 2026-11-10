import * as Customers from "@hazel/domain/customers"
import { CustomerSignalRuleId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { AccountRow, SettingsSummary, SignalRow } from "../../../../customers/queries"
import * as Modal from "../../../../ui/modal"
import { MetricRow, PickerKind, RuleRow, ScopeCondition } from "./model"

/** A rule write's failure: the rule is gone, or the store refused the draft. */
export const RuleWriteFailure = Schema.Union([Schema.Literals(["NotFound", "Invalid"]), CommonReason])
export type RuleWriteFailure = typeof RuleWriteFailure.Type

export const Message = defineMessageUnion({
	UpdatedRules: { rules: Schema.Array(RuleRow) },
	UpdatedSignals: { signals: Schema.Array(SignalRow) },
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	UpdatedConnectedProviders: { providers: Schema.Array(Customers.CustomerProvider) },
	UpdatedSettings: { settings: Schema.NullOr(SettingsSummary) },
	UpdatedMetrics: { metrics: Schema.Array(MetricRow) },

	// The list
	ToggledRule: { ruleId: CustomerSignalRuleId, enabled: Schema.Boolean },
	SucceededToggleRule: { ruleId: CustomerSignalRuleId },
	FailedToggleRule: { ruleId: CustomerSignalRuleId, enabled: Schema.Boolean, reason: RuleWriteFailure },

	// The template picker
	PressedNewSignal: {},
	GotPickerModalMessage: { message: Modal.Message },
	ChangedPickerSearch: { value: Schema.String },
	ClearedPickerSearch: {},
	ClickedPickerKind: { kind: PickerKind },
	ClickedTemplate: { template: Customers.SignalTemplate },
	PressedSetUpTemplate: {},

	// The editor's fields
	ChangedName: { value: Schema.String },
	ClickedSeverity: { severity: Customers.SignalSeverity },
	ChangedConfigNumber: { key: Schema.String, value: Schema.String },
	ToggledConfigFlag: { key: Schema.String, isOn: Schema.Boolean },
	ClickedMetric: { metricKey: Schema.String },
	ToggledLimitMetric: { metricKey: Schema.String },
	ClearedLimitMetrics: {},
	AddedScopeCondition: { condition: ScopeCondition },
	RemovedScopeCondition: { condition: ScopeCondition },
	ToggledScopeStage: { stage: Customers.LifecycleStage },
	ToggledScopePlan: { plan: Schema.String },
	ChangedScopeMrr: { value: Schema.String },
	ToggledPayingOnly: { isOn: Schema.Boolean },
	PressedToggleEnabled: {},

	// The editor's actions
	PressedSave: {},
	SucceededCreateRule: { ruleId: CustomerSignalRuleId },
	FailedCreateRule: { reason: RuleWriteFailure },
	SucceededUpdateRule: { ruleId: CustomerSignalRuleId },
	FailedUpdateRule: { ruleId: CustomerSignalRuleId, reason: RuleWriteFailure },
	PressedClose: {},
	GotDiscardModalMessage: { message: Modal.Message },
	PressedDiscard: {},
	PressedDelete: {},
	GotDeleteModalMessage: { message: Modal.Message },
	PressedConfirmDelete: {},
	SucceededDeleteRule: { ruleId: CustomerSignalRuleId },
	FailedDeleteRule: { ruleId: CustomerSignalRuleId, reason: RuleWriteFailure },

	// The live preview
	ElapsedRuleDryRunDelay: { version: Schema.Int },
	SucceededFetchDryRun: { version: Schema.Int, result: Customers.RuleDryRunResult },
	FailedFetchDryRun: { version: Schema.Int, reason: CommonReason },
	PressedRetryPreview: {},
	/** The example picker's `<select>` value: a top match's account id. */
	ChangedExampleAccount: { accountId: Schema.String },
})
export type Message = typeof Message.Type
