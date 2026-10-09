import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../../ui/aria/interaction"
import * as Segments from "../../../ui/date-segments"
import * as Slider from "../../../ui/slider"
import { UserRow } from "../user"
import { QuietHoursField, SoundFile } from "./model"

export const Message = defineMessageUnion({
	ToggledSounds: { isSelected: Schema.Boolean },
	SelectedSound: { soundFile: SoundFile },
	GotVolumeMessage: { message: Slider.Message },
	ClickedTestSound: {},
	CompletedTestSound: {},
	ClickedTestNotification: {},
	CompletedTestNotification: { isSent: Schema.Boolean },
	ExpiredNotificationStatus: { version: Schema.Number },
	UpdatedUserRow: { row: Schema.NullOr(UserRow) },
	ToggledDoNotDisturb: { isSelected: Schema.Boolean },
	ToggledShowQuietHours: { isSelected: Schema.Boolean },
	GotQuietHoursMessage: { fieldId: QuietHoursField, message: Segments.Message },
	SucceededUpdateUserSettings: {},
	FailedUpdateUserSettings: {},
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type
