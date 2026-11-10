import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { AccountRow } from "../../../../customers/queries"
import * as Select from "../../../../ui/select"
import * as Slider from "../../../../ui/slider"
import { BandKey, PreviewMetric, SavedSettings, ScoreField, SliderId, StepField, StepList } from "./model"

export const Message = defineMessageUnion({
	UpdatedSettings: { settings: Schema.NullOr(SavedSettings) },
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },

	/** A weight's stepper; its slider reports through `GotSliderMessage`. */
	ChangedWeight: { key: Customers.HealthComponentKey, value: Schema.Number },
	/**
	 * A band's number input (the handles report through `GotSliderMessage`). `NaN`: emptied or not a
	 * number yet; `text` is what was typed (`-`, `1.`), kept while it still reads as `value`.
	 */
	ChangedBand: { band: BandKey, value: Schema.Number, text: Schema.String },
	ChangedStep: {
		list: StepList,
		index: Schema.Int,
		field: StepField,
		value: Schema.Number,
		text: Schema.String,
	},
	ChangedScore: { field: ScoreField, value: Schema.Number, text: Schema.String },
	GotSliderMessage: { id: SliderId, message: Slider.Message },
	PressedScaleWeights: {},
	PressedResetDefaults: {},
	PressedDiscard: {},
	PressedSave: {},
	PressedRetryPreview: {},
	ClickedPreviewMetric: { metric: PreviewMetric },
	GotCheckAccountMessage: { message: Select.Message },

	ElapsedHealthPreviewDelay: { version: Schema.Int },
	SucceededFetchHealthDryRun: { version: Schema.Int, result: Customers.HealthDryRunResult },
	FailedFetchHealthDryRun: { version: Schema.Int, reason: CommonReason },
	SucceededFetchHealthCheckDetail: {
		accountId: CustomerAccountId,
		health: Schema.NullOr(Customers.HealthBreakdown),
	},
	FailedFetchHealthCheckDetail: { accountId: CustomerAccountId, reason: CommonReason },
	SucceededSaveHealthSettings: {},
	FailedSaveHealthSettings: { reason: CommonReason },
})
export type Message = typeof Message.Type
