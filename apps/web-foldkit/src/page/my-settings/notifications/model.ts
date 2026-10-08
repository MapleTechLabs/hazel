import { User } from "@hazel/domain/models"
import { Schema } from "effect"
import * as Interaction from "../../../ui/aria/interaction"
import * as Segments from "../../../ui/date-segments"
import * as Slider from "../../../ui/slider"

/** The sound settings are `Shared.soundSettings` (root-owned, like the legacy provider's atom). */
export {
	DEFAULT_SOUND_SETTINGS,
	SoundFile,
	SoundSettings,
} from "../../../notification-sound"

export const NotificationStatus = Schema.Literals(["idle", "sent", "unavailable"])
export type NotificationStatus = typeof NotificationStatus.Type

/**
 * One settings write runs at a time. A change made while one runs is queued as the latest snapshot,
 * so an older snapshot can never land after a newer one.
 */
export const SettingsWrite = Schema.Literals(["Idle", "Writing", "WritingWithQueued"])
export type SettingsWrite = typeof SettingsWrite.Type

export const QuietHoursField = Schema.Literals(["start", "end"])
export type QuietHoursField = typeof QuietHoursField.Type

export const Model = Schema.Struct({
	/** The user row's settings, as synced. */
	settings: Schema.NullOr(User.UserSettingsSchema),
	/** The settings the user chose while a write is in flight (the legacy optimistic collection update). */
	optimisticSettings: Schema.NullOr(User.UserSettingsSchema),
	settingsWrite: SettingsWrite,
	volume: Slider.Model,
	quietHoursStart: Segments.Model,
	quietHoursEnd: Segments.Model,
	notificationStatus: NotificationStatus,
	/** Bumped per test notification result, so an older expiry timer leaves a newer status alone. */
	notificationStatusVersion: Schema.Number,
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type

export const settingsOf = (model: Model) => model.optimisticSettings ?? model.settings
