import type { User } from "@hazel/domain/models"
import { Option } from "effect"
import { Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../../ui/aria/interaction"
import * as Segments from "../../../ui/date-segments"
import * as Slider from "../../../ui/slider"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { embedInteraction } from "../shared"
import {
	ExpireNotificationStatus,
	LoadSoundSettings,
	PlayTestSound,
	SaveSoundSettings,
	SendTestNotification,
	UpdateUserSettings,
} from "./command"
import { Message } from "./message"
import { DEFAULT_SOUND_SETTINGS, type Model, type QuietHoursField, settingsOf, type SoundSettings } from "./model"

type Return = PageReturn<Model, Message>

export const interaction = embedInteraction<Model, Message>((message) =>
	Message.GotInteractionMessage({ message }),
)

export const toVolumeMessage = (message: Slider.Message) => Message.GotVolumeMessage({ message })
export const toQuietHoursMessage = (field: QuietHoursField) => (message: Segments.Message) =>
	Message.GotQuietHoursMessage({ field, message })

const DEFAULT_QUIET_START = "22:00"
const DEFAULT_QUIET_END = "08:00"

const quietHoursOf = (model: Model) => {
	const settings = settingsOf(model)
	return {
		start: settings?.quietHoursStart ?? DEFAULT_QUIET_START,
		end: settings?.quietHoursEnd ?? DEFAULT_QUIET_END,
	}
}

const segmentsFor = (current: Segments.Model, value: string) =>
	current.committed?.slice(0, 5) === value
		? current
		: Segments.init({ id: current.id, kind: "time", value })

/** The time fields are controlled by the settings, as the legacy `value={parseTimeString(...)}`. */
const syncQuietHours = (model: Model): Model => {
	const { start, end } = quietHoursOf(model)
	return modifyFields(model, {
		quietHoursStart: (current) => segmentsFor(current, start),
		quietHoursEnd: (current) => segmentsFor(current, end),
	})
}

/** The slider follows the stored volume and is disabled with the sounds. */
const syncVolume = (model: Model): Model =>
	modifyFields(model, {
		volume: (volume) =>
			volume.values[0] === model.sound.volume && volume.isDisabled === !model.sound.enabled
				? volume
				: { ...volume, values: [model.sound.volume], isDisabled: !model.sound.enabled },
	})

const withSound = (model: Model, patch: Partial<SoundSettings>): Return => {
	const sound = { ...model.sound, ...patch }
	return {
		model: syncVolume(modifyFields(model, { sound: () => sound })),
		commands: [SaveSoundSettings({ sound })],
	}
}

/** `updateUser({ settings: { ...userData?.settings, ...patch } })`, applied optimistically. */
const withUserSettings = (model: Model, shared: Shared, patch: Partial<User.UserSettings>): Return => {
	const userId = shared.currentUser?.id
	if (userId === undefined) return { model }
	const settings = { ...settingsOf(model), ...patch }
	return {
		model: syncQuietHours(modifyFields(model, { optimisticSettings: () => settings })),
		commands: [UpdateUserSettings({ userId, settings })],
	}
}

const foldQuietHours = (field: QuietHoursField) =>
	Update.foldChild({
		update: Segments.update,
		read: (model: Model) => Option.some(field === "start" ? model.quietHoursStart : model.quietHoursEnd),
		write: (model: Model, next: Segments.Model): Model =>
			field === "start"
				? modifyFields(model, { quietHoursStart: () => next })
				: modifyFields(model, { quietHoursEnd: () => next }),
		toParentMessage: toQuietHoursMessage(field),
	})

const foldVolume = Update.foldChild({
	update: Slider.update,
	read: (model: Model) => Option.some(model.volume),
	write: (model: Model, volume: Slider.Model): Model => modifyFields(model, { volume: () => volume }),
	toParentMessage: toVolumeMessage,
})

export const init = (): Return => ({
	model: syncVolume({
		sound: DEFAULT_SOUND_SETTINGS,
		settings: null,
		optimisticSettings: null,
		volume: Slider.init({ id: "notification-volume", values: [0.5], minValue: 0, maxValue: 1, step: 0.1 }),
		quietHoursStart: Segments.init({ id: "quiet-hours-start", kind: "time", value: DEFAULT_QUIET_START }),
		quietHoursEnd: Segments.init({ id: "quiet-hours-end", kind: "time", value: DEFAULT_QUIET_END }),
		notificationStatus: "idle",
		interaction: Interaction.init(),
	}),
	commands: [LoadSoundSettings({})],
})

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		LoadedSoundSettings: ({ sound }) => ({ model: syncVolume(modifyFields(model, { sound: () => sound })) }),
		CompletedSaveSoundSettings: () => ({ model }),
		ToggledSounds: ({ isSelected }) => withSound(model, { enabled: isSelected }),
		SelectedSound: ({ soundFile }) => withSound(model, { soundFile }),
		GotVolumeMessage: ({ message: child }) => {
			const result = foldVolume(model, child)
			const volume = result.model.volume.values[0]
			if (volume === undefined || volume === model.sound.volume) return result
			const saved = withSound(result.model, { volume })
			return { model: saved.model, commands: [...(result.commands ?? []), ...(saved.commands ?? [])] }
		},
		ClickedTestSound: () => ({ model, commands: [PlayTestSound({})] }),
		CompletedTestSound: () => ({ model }),
		ClickedTestNotification: () => ({ model, commands: [SendTestNotification({})] }),
		CompletedTestNotification: ({ isSent }) => ({
			model: modifyFields(model, { notificationStatus: () => (isSent ? "sent" : "unavailable") }),
			commands: [ExpireNotificationStatus({})],
		}),
		ExpiredNotificationStatus: () => ({
			model: modifyFields(model, { notificationStatus: () => "idle" }),
		}),
		UpdatedUserRow: ({ row }) => ({
			model: syncQuietHours(
				modifyFields(model, { settings: () => row?.settings ?? null, optimisticSettings: () => null }),
			),
		}),
		ToggledDoNotDisturb: ({ isSelected }) => withUserSettings(model, shared, { doNotDisturb: isSelected }),
		ToggledShowQuietHours: ({ isSelected }) =>
			withUserSettings(model, shared, { showQuietHoursInStatus: isSelected }),
		GotQuietHoursMessage: ({ field, message: child }) => {
			const result = foldQuietHours(field)(model, child)
			const before = field === "start" ? model.quietHoursStart : model.quietHoursEnd
			const after = field === "start" ? result.model.quietHoursStart : result.model.quietHoursEnd
			const time = after.committed?.slice(0, 5)
			if (time === undefined || after.committed === before.committed) return result
			const patch = field === "start" ? { quietHoursStart: time } : { quietHoursEnd: time }
			const written = withUserSettings(result.model, shared, patch as Partial<User.UserSettings>)
			return { model: written.model, commands: [...(result.commands ?? []), ...(written.commands ?? [])] }
		},
		SucceededUpdateUserSettings: () => ({ model }),
		FailedUpdateUserSettings: () => ({
			model: syncQuietHours(modifyFields(model, { optimisticSettings: () => null })),
			outMessage: PageOutMessage.RequestedToast({
				toast: { intent: "error", title: "Failed to update setting", description: null },
			}),
		}),
		GotInteractionMessage: ({ message: child }) => interaction.fold(model, child),
	})

