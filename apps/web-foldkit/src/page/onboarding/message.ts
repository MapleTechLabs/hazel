import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { ToastRequest } from "../../overlay/toasts"
import * as Interaction from "../../ui/aria/interaction"
import * as ChoiceBox from "../../ui/choice-box"
import { Membership, Theme } from "./model"

export const Message = defineMessageUnion({
	GotBrowserTimezone: { browserTimezone: Schema.String },
	UpdatedMembership: { membership: Schema.NullOr(Membership) },
	ClickedBack: {},
	ClickedGetStarted: {},
	// Profile
	ChangedFirstName: { value: Schema.String },
	ChangedLastName: { value: Schema.String },
	SubmittedProfile: {},
	SucceededUpdateProfile: {},
	FailedUpdateProfile: {},
	// Timezone
	ChangedTimezoneQuery: { value: Schema.String },
	ElapsedTimezoneDebounce: { query: Schema.String },
	ClickedCity: { timezone: Schema.String },
	ClickedOffset: { offset: Schema.Number },
	HoveredOffset: { offset: Schema.NullOr(Schema.Number) },
	ClickedDetectTimezone: {},
	ClickedContinueTimezone: {},
	SucceededUpdateTimezone: { timezone: Schema.String },
	FailedUpdateTimezone: { toast: ToastRequest },
	// Theme
	SelectedBrandColor: { hex: Schema.String },
	SelectedTheme: { theme: Theme },
	ClickedContinueTheme: {},
	// Use case and role
	GotChoiceBoxMessage: { message: ChoiceBox.Message },
	ClickedContinueChoice: {},
	// Invite
	ChangedEmail: { index: Schema.Number, value: Schema.String },
	ClickedAddEmail: {},
	ClickedRemoveEmail: { index: Schema.Number },
	ClickedContinueInvite: {},
	SucceededSendInvites: { emails: Schema.Array(Schema.String), failedCount: Schema.Number },
	FailedSendInvites: { reason: Schema.Literals(["NoOrganization", "AllFailed"]) },
	// Finalization
	SucceededCompleteOnboarding: {},
	FailedCompleteOnboarding: { error: Schema.String },
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
