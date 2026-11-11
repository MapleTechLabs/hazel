import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../../ui/aria/interaction"
import * as Segments from "../../../ui/date-segments"
import * as Slider from "../../../ui/slider"
import { UpdateUserFailure, UserRow } from "../user"
import { QuietHoursField, SoundFile } from "./model"

/** Why the test notification did not show: no native API or permission, or the plugin threw. */
export const TestNotificationFailure = Schema.Literals(["Unavailable", "SendFailed"])
export type TestNotificationFailure = typeof TestNotificationFailure.Type

export const Message = defineMessageUnion({
	ToggledSounds: { isSelected: Schema.Boolean },
	SelectedSound: { soundFile: SoundFile },
	GotVolumeMessage: { message: Slider.Message },
	ClickedTestSound: {},
	CompletedTestSound: {},
	ClickedTestNotification: {},
	SucceededSendTestNotification: {},
	FailedSendTestNotification: { reason: TestNotificationFailure },
	ExpiredNotificationStatus: { version: Schema.Number },
	UpdatedUserRow: { row: Schema.NullOr(UserRow) },
	ToggledDoNotDisturb: { isSelected: Schema.Boolean },
	ToggledShowQuietHours: { isSelected: Schema.Boolean },
	GotQuietHoursMessage: { fieldId: QuietHoursField, message: Segments.Message },
	SucceededUpdateUserSettings: {},
	FailedUpdateUserSettings: { reason: UpdateUserFailure },
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type
