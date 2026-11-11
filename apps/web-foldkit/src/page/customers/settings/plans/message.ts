import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { SavedSettings } from "./model"

export const Message = defineMessageUnion({
	UpdatedSettings: { settings: Schema.NullOr(SavedSettings) },
	ToggledAddOn: { plan: Schema.String, isAddOn: Schema.Boolean },
	PressedRetry: {},

	SucceededFetchPlans: { plans: Schema.Array(Schema.String) },
	FailedFetchPlans: { reason: CommonReason },
	SucceededSaveAddOnPlans: {},
	FailedSaveAddOnPlans: { reason: CommonReason },
})
export type Message = typeof Message.Type
