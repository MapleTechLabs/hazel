import { User } from "@hazel/domain/models"
import { Option, Schema } from "effect"
import { Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { errorToast } from "../../../data/actions"
import * as Interaction from "../../../ui/aria/interaction"
import * as Segments from "../../../ui/date-segments"
import * as Slider from "../../../ui/slider"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { embedInteraction } from "../shared"
import {
	ExpireNotificationStatus,
	PlayTestSound,
	SendTestNotification,
	UpdateUserSettings,
} from "./command"
import { Message } from "./message"
import {
	type Model,
	type QuietHoursField,
	settingsOf,
	type SoundSettings,
} from "./model"

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
const syncVolume = (model: Model, sound: SoundSettings): Model =>
	modifyFields(model, {
		volume: (volume) =>
			volume.values[0] === sound.volume && volume.isDisabled === !sound.enabled
				? volume
				: { ...volume, values: [sound.volume], isDisabled: !sound.enabled },
	})

/** `updateSettings(patch)`: the root stores it and informs the page (`sharedChanged`). */
const withSound = (model: Model, shared: Shared, patch: Partial<SoundSettings>): Return => {
	const settings = { ...shared.soundSettings, ...patch }
	return {
		model: syncVolume(model, settings),
		outMessage: PageOutMessage.RequestedSoundSettings({ settings }),
	}
}

/** `updateUser({ settings: { ...userData?.settings, ...patch } })`, applied optimistically. */
const withUserSettings = (model: Model, shared: Shared, patch: Partial<User.UserSettings>): Return => {
	const userId = shared.currentUser?.id
	if (userId === undefined) return { model }
	const settings = { ...settingsOf(model), ...patch }
	const next = syncQuietHours(modifyFields(model, { optimisticSettings: () => settings }))
	return model.settingsWrite === "Idle"
		? {
				model: modifyFields(next, { settingsWrite: () => "Writing" }),
				commands: [UpdateUserSettings({ userId, settings })],
			}
		: { model: modifyFields(next, { settingsWrite: () => "WritingWithQueued" }) }
}

/** A write settled: send the queued snapshot, or finish with `settled` as the settings. */
const settleWrite = (
	model: Model,
	shared: Shared,
	settled: (model: Model) => User.UserSettings | null,
): Return => {
	const userId = shared.currentUser?.id
	const queued = model.optimisticSettings
	if (model.settingsWrite === "WritingWithQueued" && queued !== null && userId !== undefined)
		return {
			model: modifyFields(model, { settingsWrite: () => "Writing" }),
			commands: [UpdateUserSettings({ userId, settings: queued })],
		}
	return {
		model: syncQuietHours(
			modifyFields(model, {
				settings: () => settled(model),
				optimisticSettings: () => null,
				settingsWrite: () => "Idle",
			}),
		),
	}
}

const decodeTimeString = Schema.decodeUnknownOption(User.TimeString)

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

export const init = (_route: unknown, shared: Shared): Return => ({
	model: syncVolume(
		{
		settings: null,
		optimisticSettings: null,
		settingsWrite: "Idle",
		volume: Slider.init({
			id: "notification-volume",
			values: [0.5],
			minValue: 0,
			maxValue: 1,
			step: 0.1,
		}),
		quietHoursStart: Segments.init({ id: "quiet-hours-start", kind: "time", value: DEFAULT_QUIET_START }),
		quietHoursEnd: Segments.init({ id: "quiet-hours-end", kind: "time", value: DEFAULT_QUIET_END }),
		notificationStatus: "idle",
		notificationStatusVersion: 0,
		interaction: Interaction.init(),
		},
		shared.soundSettings,
	),
})

export const sharedChanged = (model: Model, shared: Shared): Return => ({
	model: syncVolume(model, shared.soundSettings),
})

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		ToggledSounds: ({ isSelected }) => withSound(model, shared, { enabled: isSelected }),
		SelectedSound: ({ soundFile }) => withSound(model, shared, { soundFile }),
		GotVolumeMessage: ({ message: child }) => {
			const result = foldVolume(model, child)
			const volume = result.model.volume.values[0]
			if (volume === undefined || volume === shared.soundSettings.volume) return result
			return { ...withSound(result.model, shared, { volume }), commands: result.commands ?? [] }
		},
		ClickedTestSound: () => ({ model, commands: [PlayTestSound()] }),
		CompletedTestSound: () => ({ model }),
		ClickedTestNotification: () => ({ model, commands: [SendTestNotification()] }),
		CompletedTestNotification: ({ isSent }) => {
			const version = model.notificationStatusVersion + 1
			return {
				model: modifyFields(model, {
					notificationStatus: () => (isSent ? "sent" : "unavailable"),
					notificationStatusVersion: () => version,
				}),
				commands: [ExpireNotificationStatus({ version })],
			}
		},
		ExpiredNotificationStatus: ({ version }) => ({
			model:
				version === model.notificationStatusVersion
					? modifyFields(model, { notificationStatus: () => "idle" })
					: model,
		}),
		// The synced row replaces the optimistic settings only once no write is in flight.
		UpdatedUserRow: ({ row }) => ({
			model: syncQuietHours(
				modifyFields(model, {
					settings: () => row?.settings ?? null,
					optimisticSettings: (optimistic) => (model.settingsWrite === "Idle" ? null : optimistic),
				}),
			),
		}),
		ToggledDoNotDisturb: ({ isSelected }) =>
			withUserSettings(model, shared, { doNotDisturb: isSelected }),
		ToggledShowQuietHours: ({ isSelected }) =>
			withUserSettings(model, shared, { showQuietHoursInStatus: isSelected }),
		GotQuietHoursMessage: ({ field, message: child }) => {
			const result = foldQuietHours(field)(model, child)
			const before = field === "start" ? model.quietHoursStart : model.quietHoursEnd
			const after = field === "start" ? result.model.quietHoursStart : result.model.quietHoursEnd
			const time = Option.fromNullishOr(after.committed?.slice(0, 5)).pipe(Option.flatMap(decodeTimeString))
			if (Option.isNone(time) || after.committed === before.committed) return result
			const patch = field === "start" ? { quietHoursStart: time.value } : { quietHoursEnd: time.value }
			const written = withUserSettings(result.model, shared, patch)
			return {
				model: written.model,
				commands: [...(result.commands ?? []), ...(written.commands ?? [])],
			}
		},
		// The server now holds the written snapshot, so it stands until the synced row echoes it.
		SucceededUpdateUserSettings: () =>
			settleWrite(model, shared, (current) => current.optimisticSettings ?? current.settings),
		FailedUpdateUserSettings: () => ({
			...settleWrite(model, shared, (current) => current.settings),
			outMessage: PageOutMessage.RequestedToast({ toast: errorToast("Failed to update setting") }),
		}),
		GotInteractionMessage: ({ message: child }) => interaction.fold(model, child),
	})
