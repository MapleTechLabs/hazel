import { User } from "@hazel/domain/models"
import { Option, Schema } from "effect"
import { Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { errorToast } from "../../../data/actions"
import * as Interaction from "../../../ui/aria/interaction"
import * as Segments from "../../../ui/date-segments"
import * as Slider from "../../../ui/slider"
import type { PageReturn, PageSubscriptionInput, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import {
	ExpireNotificationStatus,
	PlayTestSound,
	ResetOverride,
	SaveOrganizationSettings,
	SendTestNotification,
	UpdateUserSettings,
} from "./command"
import { applied, DEFAULTS, type OrganizationSettings } from "./organization"
import { Message } from "./message"
import { updateUserFailureCopy } from "../user"
import {
	type Model,
	type NotificationStatus,
	organizationSettingsOf,
	type QuietHoursField,
	settingsOf,
	type SoundSettings,
} from "./model"

type Return = PageReturn<Model, Message>

export const interaction = Interaction.embed<Model, Message, PageSubscriptionInput<Model>>(
	(message) => Message.GotInteractionMessage({ message }),
	(input) => input.model,
)

export const toVolumeMessage = (message: Slider.Message) => Message.GotVolumeMessage({ message })
export const toQuietHoursMessage = (field: QuietHoursField) => (message: Segments.Message) =>
	Message.GotQuietHoursMessage({ fieldId: field, message })

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

/** `updateSettings(patch)`: the root stores it and informs the page (`sharedChanged`). */
const withSound = (model: Model, shared: Shared, patch: Partial<SoundSettings>): Return => {
	const settings = { ...shared.soundSettings, ...patch }
	return {
		model,
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

/** A change to "This organization", shown at once; one write runs at a time, the latest snapshot queued. */
const withOrganizationSettings = (model: Model, shared: Shared, settings: OrganizationSettings): Return => {
	const organizationId = shared.organization?.id
	if (organizationId === undefined) return { model }
	const next = modifyFields(model, { optimisticOrganizationSettings: () => settings })
	return model.organizationWrite === "Idle"
		? {
				model: modifyFields(next, { organizationWrite: () => "Writing" }),
				commands: [SaveOrganizationSettings({ organizationId, settings })],
			}
		: { model: modifyFields(next, { organizationWrite: () => "WritingWithQueued" }) }
}

/** An organization write settled: send the queued snapshot, or finish with `settled` as the settings. */
const settleOrganizationWrite = (
	model: Model,
	shared: Shared,
	settled: (model: Model) => OrganizationSettings,
): Return => {
	const organizationId = shared.organization?.id
	const queued = model.optimisticOrganizationSettings
	if (model.organizationWrite === "WritingWithQueued" && queued !== null && organizationId !== undefined)
		return {
			model: modifyFields(model, { organizationWrite: () => "Writing" }),
			commands: [SaveOrganizationSettings({ organizationId, settings: queued })],
		}
	return {
		model: modifyFields(model, {
			organizationSettings: () => settled(model),
			optimisticOrganizationSettings: () => null,
			organizationWrite: () => "Idle",
		}),
	}
}

const sameSettings = (a: OrganizationSettings, b: OrganizationSettings) =>
	a.level === b.level &&
	a.isMuted === b.isMuted &&
	a.mutedUntilMs === b.mutedUntilMs &&
	a.suppressEveryone === b.suppressEveryone

/** Shows the test notification's outcome; `ExpireNotificationStatus` clears it after 3 seconds. */
const showNotificationStatus = (model: Model, status: NotificationStatus): Return => {
	const version = model.notificationStatusVersion + 1
	return {
		model: modifyFields(model, {
			notificationStatus: () => status,
			notificationStatusVersion: () => version,
		}),
		commands: [ExpireNotificationStatus({ version })],
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

/** The volume lives in `Shared.soundSettings`; the Slider holds only the drag and reports changes. */
const volumeChanged = (model: Model, shared: Shared, message: Slider.Message): Return => {
	const result = Slider.update(model.volume, message)
	const next = modifyFields(model, { volume: () => result.model })
	const changed = result.outMessage
	return changed === undefined || changed.value === shared.soundSettings.volume
		? { model: next }
		: withSound(next, shared, { volume: changed.value })
}

export const init = (): Return => ({
	model: {
		settings: null,
		optimisticSettings: null,
		settingsWrite: "Idle",
		volume: Slider.init({ id: "notification-volume", min: 0, max: 1, step: 0.1 }),
		quietHoursStart: Segments.init({ id: "quiet-hours-start", kind: "time", value: DEFAULT_QUIET_START }),
		quietHoursEnd: Segments.init({ id: "quiet-hours-end", kind: "time", value: DEFAULT_QUIET_END }),
		notificationStatus: "idle",
		notificationStatusVersion: 0,
		interaction: Interaction.init(),
		organizationSettings: DEFAULTS,
		channelOverrides: [],
		sectionOverrides: [],
		optimisticOrganizationSettings: null,
		organizationWrite: "Idle",
	},
})

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		ToggledSounds: ({ isSelected }) => withSound(model, shared, { enabled: isSelected }),
		SelectedSound: ({ soundFile }) => withSound(model, shared, { soundFile }),
		GotVolumeMessage: ({ message: child }) => volumeChanged(model, shared, child),
		ClickedTestSound: () => ({ model, commands: [PlayTestSound()] }),
		CompletedTestSound: () => ({ model }),
		ClickedTestNotification: () => ({ model, commands: [SendTestNotification()] }),
		SucceededSendTestNotification: () => showNotificationStatus(model, "sent"),
		// Either way the note says native notifications are unavailable here.
		FailedSendTestNotification: () => showNotificationStatus(model, "unavailable"),
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
		GotQuietHoursMessage: ({ fieldId: field, message: child }) => {
			const result = foldQuietHours(field)(model, child)
			const before = field === "start" ? model.quietHoursStart : model.quietHoursEnd
			const after = field === "start" ? result.model.quietHoursStart : result.model.quietHoursEnd
			const time = Option.fromNullishOr(after.committed?.slice(0, 5)).pipe(
				Option.flatMap(decodeTimeString),
			)
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
		FailedUpdateUserSettings: ({ reason }) => ({
			...settleWrite(model, shared, (current) => current.settings),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToast(
					"Failed to update setting",
					failureMessage(reason, updateUserFailureCopy).description ?? null,
				),
			}),
		}),
		GotInteractionMessage: ({ message: child }) => interaction.fold(model, child),
		// As `UpdatedUserRow`: the synced row replaces the optimistic settings once no write is in flight.
		UpdatedOrganizationSettings: ({ settings }) => ({
			model: modifyFields(model, {
				organizationSettings: () => settings,
				optimisticOrganizationSettings: (optimistic) =>
					model.organizationWrite === "Idle" ? null : optimistic,
			}),
		}),
		// Shown at once; picking what is already shown (the running timed mute) writes nothing.
		ChangedOrganizationSettings: ({ change }) => {
			const current = organizationSettingsOf(model)
			const settings = applied(current, change, shared.nowMs)
			return sameSettings(settings, current)
				? { model }
				: withOrganizationSettings(model, shared, settings)
		},
		SucceededSaveOrganizationSettings: () =>
			settleOrganizationWrite(
				model,
				shared,
				(current) => current.optimisticOrganizationSettings ?? current.organizationSettings,
			),
		UpdatedChannelOverrides: ({ overrides }) => ({
			model: modifyFields(model, { channelOverrides: () => overrides }),
		}),
		UpdatedSectionOverrides: ({ overrides }) => ({
			model: modifyFields(model, { sectionOverrides: () => overrides }),
		}),
		ClickedResetOverride: ({ override }) =>
			shared.organization === null
				? { model }
				: { model, commands: [ResetOverride({ organizationId: shared.organization.id, override })] },
		CompletedResetOverride: ({ isSuccess }) =>
			isSuccess
				? { model }
				: {
						model,
						outMessage: PageOutMessage.RequestedToast({
							toast: errorToast("Couldn't reset the setting", "Try again in a moment."),
						}),
					},
		// The last synced settings come back; a newer queued choice is still sent.
		FailedSaveOrganizationSettings: () => ({
			...settleOrganizationWrite(model, shared, (current) => current.organizationSettings),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToast(
					"Failed to update setting",
					"Your organization notification settings did not save.",
				),
			}),
		}),
	})
