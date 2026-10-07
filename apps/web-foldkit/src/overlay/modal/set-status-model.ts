import { Option, Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Segments from "../../ui/date-segments"
import * as Select from "../../ui/select"
import { ToastRequest } from "../toasts"
import { Frame, FrameMessage } from "./frame"

/** Model, Messages and the pure helpers of the set-status modal (`set-status.ts`). */

export const ID = "set-status-modal"

export const Presence = Schema.Struct({
	statusEmoji: Schema.NullOr(Schema.String),
	customMessage: Schema.NullOr(Schema.String),
	suppressNotifications: Schema.Boolean,
})
export type Presence = typeof Presence.Type

export const Model = Schema.Struct({
	frame: Frame,
	/** The user's presence row (`usePresence()`); the form is seeded from its first emission. */
	presence: Schema.NullOr(Presence),
	hasSeeded: Schema.Boolean,
	emoji: Schema.NullOr(Schema.String),
	message: Schema.String,
	expiration: Select.Model,
	customDate: Schema.NullOr(Segments.Model),
	customTime: Schema.NullOr(Segments.Model),
	pauseNotifications: Schema.Boolean,
	isSubmitting: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	GotExpirationMessage: { message: Select.Message },
	GotCustomDateMessage: { message: Segments.Message },
	GotCustomTimeMessage: { message: Segments.Message },
	UpdatedPresence: { presence: Schema.NullOr(Presence) },
	ChangedMessage: { value: Schema.String },
	ToggledPauseNotifications: { isSelected: Schema.Boolean },
	ClickedPreset: { emoji: Schema.String, message: Schema.String },
	ClickedCancel: {},
	ClickedSave: {},
	ClickedClear: {},
	SucceededSaveStatus: {},
	FailedSaveStatus: { toast: ToastRequest },
	SucceededClearStatus: {},
	FailedClearStatus: { toast: ToastRequest },
})
export type Message = typeof Message.Type

export const EXPIRATION_OPTIONS: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
	{ id: "never", label: "Don't clear" },
	{ id: "30min", label: "30 minutes" },
	{ id: "1hr", label: "1 hour" },
	{ id: "4hr", label: "4 hours" },
	{ id: "today", label: "Today" },
	{ id: "week", label: "This week" },
	{ id: "custom", label: "Choose date & time" },
]

export const STATUS_PRESETS: ReadonlyArray<{ readonly emoji: string; readonly message: string }> = [
	{ emoji: "📅", message: "In a meeting" },
	{ emoji: "🚗", message: "Commuting" },
	{ emoji: "🤒", message: "Out sick" },
	{ emoji: "🌴", message: "Vacationing" },
	{ emoji: "🏠", message: "Working from home" },
]

export const expirationOf = (model: Model) => Option.getOrElse(model.expiration.selectedKey, () => "never")

/** Committed `YYYY-MM-DD` and `HH:MM:SS` as a local Date (`customDate.toDate(local)` + setHours). */
export const customDateTime = (customDate: string | null, customTime: string | null): Date | null => {
	if (customDate === null || customTime === null) return null
	const [year = 0, month = 1, day = 1] = customDate.split("-").map(Number)
	const [hour = 0, minute = 0] = customTime.split(":").map(Number)
	return new Date(year, month - 1, day, hour, minute, 0, 0)
}

/** Legacy `getExpirationDate`, from the clock reading `now`. */
export const expirationDate = (
	option: string,
	customDate: string | null,
	customTime: string | null,
	now: Date,
): Date | null => {
	const inMinutes = (minutes: number) => new Date(now.getTime() + minutes * 60 * 1000)
	const endOfDayIn = (days: number) => {
		const end = new Date(now)
		end.setDate(now.getDate() + days)
		end.setHours(23, 59, 59, 999)
		return end
	}
	const byOption: Readonly<Record<string, () => Date | null>> = {
		"30min": () => inMinutes(30),
		"1hr": () => inMinutes(60),
		"4hr": () => inMinutes(4 * 60),
		today: () => endOfDayIn(0),
		// End of the week (Sunday 23:59:59).
		week: () => endOfDayIn(7 - now.getDay()),
		custom: () => customDateTime(customDate, customTime),
	}
	return byOption[option]?.() ?? null
}

const committedOf = (segments: Segments.Model | null) => segments?.committed ?? null

/** The custom option's label once both parts are set (legacy `customDateTimeLabel`). */
const customLabel = (model: Model): string | null => {
	if (expirationOf(model) !== "custom") return null
	const date = customDateTime(committedOf(model.customDate), committedOf(model.customTime))
	return date === null
		? null
		: date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

/** Rebuilds the Select items so the custom option shows the chosen date and time. */
export const withExpirationItems = (model: Model): Model => {
	const label = customLabel(model)
	const items = EXPIRATION_OPTIONS.map((option) =>
		Select.item(option.id, option.id === "custom" && label !== null ? label : option.label),
	)
	return { ...model, expiration: { ...model.expiration, items } }
}

const pad = (value: number) => String(value).padStart(2, "0")

/** Defaults when "custom" is picked: today, and the next full hour. */
export const todayValue = (nowMs: number) => {
	const now = new Date(nowMs)
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
export const nextHourValue = (nowMs: number) => `${pad((new Date(nowMs).getHours() + 1) % 24)}:00`

export const isSaveDisabled = (model: Model) =>
	model.isSubmitting ||
	(!model.emoji && model.message === "") ||
	(expirationOf(model) === "custom" &&
		(committedOf(model.customDate) === null || committedOf(model.customTime) === null))

export const hasExistingStatus = (model: Model) =>
	model.presence !== null && (!!model.presence.statusEmoji || !!model.presence.customMessage)
