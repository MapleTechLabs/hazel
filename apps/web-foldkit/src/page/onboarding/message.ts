import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import * as Interaction from "../../ui/aria/interaction"
import * as ChoiceBox from "../../ui/choice-box"
import { Membership, Theme, UpdateUserFailure } from "./model"

export const Message = defineMessageUnion({
	DetectedBrowserTimezone: { browserTimezone: Schema.String },
	UpdatedMembership: { membership: Schema.NullOr(Membership) },
	ClickedBack: {},
	ClickedGetStarted: {},
	// Profile
	ChangedFirstName: { value: Schema.String },
	ChangedLastName: { value: Schema.String },
	SubmittedProfile: {},
	SucceededUpdateProfile: {},
	FailedUpdateProfile: { reason: UpdateUserFailure },
	// Timezone
	ChangedTimezoneQuery: { value: Schema.String },
	ElapsedTimezoneDebounce: { query: Schema.String },
	ClickedCity: { timezone: Schema.String },
	ClickedOffset: { offset: Schema.Number },
	HoveredOffset: { offset: Schema.NullOr(Schema.Number) },
	ClickedDetectTimezone: {},
	ClickedContinueTimezone: {},
	SucceededUpdateTimezone: { timezone: Schema.String },
	FailedUpdateTimezone: { reason: UpdateUserFailure },
	// Theme
	SelectedBrandColor: { hex: Schema.String },
	SelectedTheme: { theme: Theme },
	ClickedContinueTheme: {},
	// Use case and role
	GotChoiceBoxMessage: { message: ChoiceBox.Message },
	ClickedContinueChoice: {},
	// Invite
	ChangedEmail: { rowId: Schema.Number, value: Schema.String },
	ClickedAddEmail: {},
	ClickedRemoveEmail: { rowId: Schema.Number },
	ClickedContinueInvite: {},
	SucceededSendInvites: { emails: Schema.Array(Schema.String), failedCount: Schema.Number },
	/** Every invitation failed (`sendInvitations` reports per-address failures as counts). */
	FailedSendInvites: { reason: Schema.Literals(["AllFailed"]) },
	// Finalization
	SucceededCompleteOnboarding: {},
	FailedCompleteOnboarding: { reason: CommonReason },
	ClickedRetryFinalize: {},
	CompletedReplaceStepUrl: {},
	CompletedLoadHome: {},
	CompletedAutoFocus: {},
	StartedGlobeAnimation: {},
	CompletedEnterAnimation: {},
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type

export const toInteractionMessage = (message: Interaction.Message): Message =>
	Message.GotInteractionMessage({ message })
