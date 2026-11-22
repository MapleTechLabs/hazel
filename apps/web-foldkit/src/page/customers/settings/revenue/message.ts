import * as Customers from "@hazel/domain/customers"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import * as Modal from "../../../../ui/modal"
import * as Select from "../../../../ui/select"
import { SavedSettings } from "./model"

const ConditionAt = { ruleId: Schema.String, index: Schema.Int }

export const Message = defineMessageUnion({
	UpdatedSettings: { settings: Schema.NullOr(SavedSettings) },

	GotSelectMessage: { selectId: Schema.String, message: Select.Message },
	PressedAddRule: {},
	ChangedRuleName: { ruleId: Schema.String, name: Schema.String },
	PressedMoveRule: { ruleId: Schema.String, step: Schema.Literals([-1, 1]) },
	PressedDeleteRule: { ruleId: Schema.String },
	PressedAddCondition: { ruleId: Schema.String },
	PressedRemoveCondition: ConditionAt,
	/** An enum chip, or a chosen value's remove button. */
	ToggledValue: { ...ConditionAt, value: Schema.String },
	ChangedMetadataKey: { ...ConditionAt, key: Schema.String },
	ChangedValueEntry: { ...ConditionAt, text: Schema.String },
	SubmittedValueEntry: ConditionAt,

	PressedDiscard: {},
	PressedSave: {},
	PressedConfirmSave: {},
	GotConfirmModalMessage: { message: Modal.Message },
	PressedRetryPreview: {},
	PressedRetryCatalog: {},

	ElapsedRevenuePreviewDelay: { version: Schema.Int },
	SucceededFetchRevenuePreview: { version: Schema.Int, result: Customers.RevenuePreviewResult },
	FailedFetchRevenuePreview: { version: Schema.Int, reason: CommonReason },
	SucceededFetchRevenueCatalog: { catalog: Customers.RevenueCatalog },
	FailedFetchRevenueCatalog: { reason: CommonReason },
	SucceededSaveRevenueSettings: {},
	FailedSaveRevenueSettings: { reason: CommonReason },
})
export type Message = typeof Message.Type
