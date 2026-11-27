// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Set a status (today's `overlay/modal/set-status*.ts`, legacy `set-status-modal.tsx`): an emoji
 * and a message, when it clears, whether notifications pause, and presets. The same
 * `userPresenceStatus.update` / `clearStatus` RPCs as today; the presence row decides "Clear status".
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { eq } from "@tanstack/db"
import { Cause, Clock, Effect, Layer, Option, Schema, Stream } from "effect"
import { liveQuery } from "../app/live"
import { Session } from "../app/session"
import { copyOf, errorToast, ModalEvents, reasonOf, successToast, toast } from "./feedback"
import { modalServices } from "./services"

export const Expiration = Schema.Literals(["never", "30min", "1hr", "4hr", "today", "week", "custom"])
export type Expiration = typeof Expiration.Type

export const EXPIRATIONS: ReadonlyArray<{ readonly value: Expiration; readonly label: string }> = [
	{ value: "never", label: "Don't clear" },
	{ value: "30min", label: "30 minutes" },
	{ value: "1hr", label: "1 hour" },
	{ value: "4hr", label: "4 hours" },
	{ value: "today", label: "Today" },
	{ value: "week", label: "This week" },
	{ value: "custom", label: "Choose date & time" },
]

export const STATUS_PRESETS: ReadonlyArray<{ readonly emoji: string; readonly message: string }> = [
	{ emoji: "📅", message: "In a meeting" },
	{ emoji: "🚗", message: "Commuting" },
	{ emoji: "🤒", message: "Out sick" },
	{ emoji: "🌴", message: "Vacationing" },
	{ emoji: "🏠", message: "Working from home" },
]

/** Legacy `maxLength={255}` on the message. */
const MAX_MESSAGE = 255

export const Presence = Schema.Struct({
	statusEmoji: Schema.NullOr(Schema.String),
	customMessage: Schema.NullOr(Schema.String),
})
export type Presence = typeof Presence.Type

export const SetStatusProps = Schema.Struct({
	session: Session,
	/** The app's clock, for the custom option's defaults. */
	nowMs: Schema.Finite,
})
export type SetStatusProps = typeof SetStatusProps.Type

export const SetStatusModel = Schema.Struct({
	/** The user's newest presence row (`usePresence()`); it only decides "Clear status". */
	presence: Schema.NullOr(Presence),
	emoji: Schema.NullOr(Schema.String),
	emojiPickerOpen: Schema.Boolean,
	message: TextField.State,
	expiration: Expiration,
	/** The custom option's date (`YYYY-MM-DD`) and time (`HH:MM`), local. */
	customDate: Schema.NullOr(Schema.String),
	customTime: Schema.NullOr(Schema.String),
	pauseNotifications: Schema.Boolean,
	submitting: Schema.Boolean,
})
export type SetStatusModel = typeof SetStatusModel.Type

export const SetStatusMessage = UiSchema.TaggedEnum({
	UpdatedPresence: { presence: Schema.NullOr(Presence) },
	PressedEmoji: {},
	PickedEmoji: { emoji: Schema.String },
	DismissedEmojiPicker: {},
	ChangedMessage: { payload: TextField.ChangePayload },
	ChangedExpiration: { value: Schema.String },
	ChangedCustomDate: { value: Schema.NullOr(Schema.String) },
	ChangedCustomTime: { value: Schema.NullOr(Schema.String) },
	ToggledPauseNotifications: { checked: Schema.Boolean },
	PressedPreset: { emoji: Schema.String, message: Schema.String },
	PressedSave: {},
	PressedClear: {},
	PressedCancel: {},
	DismissedDialog: {},
	SucceededSaveStatus: {},
	FailedSaveStatus: {},
})
export type SetStatusMessage = typeof SetStatusMessage.Type

/** `YYYY-MM-DD` and `HH:MM` as a local Date. */
export const customDateTime = (date: string | null, time: string | null): Date | null => {
	if (date === null || time === null) return null
	const [year = 0, month = 1, day = 1] = date.split("-").map(Number)
	const [hour = 0, minute = 0] = time.split(":").map(Number)
	return new Date(year, month - 1, day, hour, minute, 0, 0)
}

/** Legacy `getExpirationDate`, from the clock reading `now`. */
export const expirationDate = (
	expiration: Expiration,
	date: string | null,
	time: string | null,
	now: Date,
): Date | null => {
	const inMinutes = (minutes: number) => new Date(now.getTime() + minutes * 60 * 1000)
	const endOfDayIn = (days: number) => {
		const end = new Date(now)
		end.setDate(now.getDate() + days)
		end.setHours(23, 59, 59, 999)
		return end
	}
	const byOption: { readonly [E in Expiration]: () => Date | null } = {
		never: () => null,
		"30min": () => inMinutes(30),
		"1hr": () => inMinutes(60),
		"4hr": () => inMinutes(4 * 60),
		today: () => endOfDayIn(0),
		// End of the week (Sunday 23:59:59).
		week: () => endOfDayIn(7 - now.getDay()),
		custom: () => customDateTime(date, time),
	}
	return byOption[expiration]()
}

const pad = (value: number) => String(value).padStart(2, "0")

/** Defaults when "custom" is picked: today, and the next full hour. */
export const todayValue = (nowMs: number) => {
	const now = new Date(nowMs)
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
export const nextHourValue = (nowMs: number) => `${pad((new Date(nowMs).getHours() + 1) % 24)}:00`

export const isSaveDisabled = (model: SetStatusModel) =>
	model.submitting ||
	(!model.emoji && model.message.text === "") ||
	(model.expiration === "custom" && (model.customDate === null || model.customTime === null))

export const hasExistingStatus = (model: SetStatusModel) =>
	model.presence !== null && (!!model.presence.statusEmoji || !!model.presence.customMessage)

/** The custom option's label once both parts are set (legacy `customDateTimeLabel`). */
const expirationLabel = (model: SetStatusModel, option: (typeof EXPIRATIONS)[number]) => {
	const date = option.value === "custom" ? customDateTime(model.customDate, model.customTime) : null
	return date === null
		? option.label
		: date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

const failed = (cause: Cause.Cause<unknown>) =>
	toast(errorToast(copyOf(reasonOf(Option.getOrUndefined(Cause.findErrorOption(cause))), {}))).pipe(
		Effect.as(SetStatusMessage.FailedSaveStatus()),
	)

/** `userPresenceStatus.update`; the expiry is read off the clock when it runs. */
export class SaveStatus extends Command.Service<SaveStatus>()("hazel/modals/SaveStatus", {
	args: {
		statusEmoji: Schema.NullOr(Schema.String),
		customMessage: Schema.NullOr(Schema.String),
		expiration: Expiration,
		customDate: Schema.NullOr(Schema.String),
		customTime: Schema.NullOr(Schema.String),
		suppressNotifications: Schema.Boolean,
	},
	success: SetStatusMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				({ expiration, customDate, customTime, ...fields }) =>
					run(
						Effect.gen(function* () {
							const now = new Date(yield* Clock.currentTimeMillis)
							const client = yield* HazelRpc
							yield* client("userPresenceStatus.update", {
								...fields,
								statusExpiresAt: expirationDate(expiration, customDate, customTime, now),
							})
							yield* toast(successToast("Status updated"))
						}).pipe(Effect.as(SetStatusMessage.SucceededSaveStatus()), Effect.catchCause(failed)),
					),
		),
	)
}

/** `userPresenceStatus.clearStatus`. */
export class ClearStatus extends Command.Service<ClearStatus>()("hazel/modals/ClearStatus", {
	args: {},
	success: SetStatusMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				() =>
					run(
						Effect.gen(function* () {
							const client = yield* HazelRpc
							yield* client("userPresenceStatus.clearStatus", {})
							yield* toast(successToast("Status cleared"))
						}).pipe(Effect.as(SetStatusMessage.SucceededSaveStatus()), Effect.catchCause(failed)),
					),
		),
	)
}

/** `currentUserPresenceAtomFamily`: the user's newest presence row. */
const presenceOf = (userId: UserId) =>
	liveQuery<{ readonly statusEmoji?: string | null; readonly customMessage?: string | null }, SetStatusMessage>(
		(data) => (q) =>
			q
				.from({ presence: data.collections.userPresenceStatusCollection })
				.where(({ presence }) => eq(presence.userId, userId))
				.orderBy(({ presence }) => presence.updatedAt, "desc")
				.limit(1),
		(rows) => {
			const row = rows[0]
			return SetStatusMessage.UpdatedPresence({
				presence:
					row === undefined
						? null
						: { statusEmoji: row.statusEmoji ?? null, customMessage: row.customMessage ?? null },
			})
		},
	)

const isExpiration = Schema.is(Expiration)
const close = ModalEvents.RequestedClose()

export const SetStatusModalNoDeps = Hazel.component({
	name: "SetStatusModal",
	props: SetStatusProps,
	model: SetStatusModel,
	message: SetStatusMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, submitting: false, emojiPickerOpen: false }),
}).make({
	// Legacy seeds its state before the presence row syncs: the form starts empty.
	init: () => ({
		presence: null,
		emoji: null,
		emojiPickerOpen: false,
		message: TextField.empty,
		expiration: "never",
		customDate: null,
		customTime: null,
		pauseNotifications: false,
		submitting: false,
	}),
	update: {
		UpdatedPresence: ($, { presence }) => $.evolve({ presence }),
		PressedEmoji: ($) => $.evolve({ emojiPickerOpen: true }),
		PickedEmoji: ($, { emoji }) => $.evolve({ emoji, emojiPickerOpen: false }),
		DismissedEmojiPicker: ($) => $.evolve({ emojiPickerOpen: false }),
		ChangedMessage: ($, { payload }) =>
			$.evolve({
				message: (message) => {
					const next = TextField.changed(message, payload)
					return next.text.length > MAX_MESSAGE ? TextField.set(next, next.text.slice(0, MAX_MESSAGE)) : next
				},
			}),
		// Picking "custom" defaults the date to today and the time to the next hour.
		ChangedExpiration: ($, { value }) =>
			!isExpiration(value)
				? $.model
				: value === "custom"
					? $.evolve({
							expiration: value,
							customDate: (date) => date ?? todayValue($.props.nowMs),
							customTime: (time) => time ?? nextHourValue($.props.nowMs),
						})
					: $.evolve({ expiration: value }),
		ChangedCustomDate: ($, { value }) => $.evolve({ customDate: value }),
		ChangedCustomTime: ($, { value }) => $.evolve({ customTime: value }),
		ToggledPauseNotifications: ($, { checked }) => $.evolve({ pauseNotifications: checked }),
		PressedPreset: ($, { emoji, message }) =>
			$.evolve({ emoji, message: (field) => TextField.set(field, message) }),
		// `setCustomStatus` / `clearCustomStatus` do nothing without a signed-in user.
		PressedSave: ($) =>
			isSaveDisabled($.model) || $.props.session.user === null
				? $.model
				: $.evolve({ submitting: true }).run(
						SaveStatus.make({
							statusEmoji: $.model.emoji,
							customMessage: $.model.message.text || null,
							expiration: $.model.expiration,
							customDate: $.model.customDate,
							customTime: $.model.customTime,
							suppressNotifications: $.model.pauseNotifications,
						}),
					),
		PressedClear: ($) =>
			$.model.submitting || $.props.session.user === null
				? $.model
				: $.evolve({ submitting: true }).run(ClearStatus.make({})),
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededSaveStatus: ($) => $.emit(close),
		FailedSaveStatus: ($) => $.evolve({ submitting: false }),
	},
	subscriptions: ({ props }) => [
		Subscription.make("presence", [props.session.user?.id ?? null], ([userId]) =>
			userId === null ? Stream.empty : presenceOf(userId),
		),
	],
	view: (h, model) => {
		const today = todayValue(h.props.nowMs)
		return h.dialog
			.open(true)
			.title("Set a status")
			.description("Let others know what you're up to.")
			.on("dismiss", SetStatusMessage.DismissedDialog())
			.children(
				// HAZEL-GAP(p4-status-emoji-field): today the emoji button sits inside the Status field's row.
				h.stack
					.axis("horizontal")
					.align("end")
					.density("compact")
					.children(
						h.button
							.label(model.emoji || "😊")
							.variant("outline")
							.on("press", SetStatusMessage.PressedEmoji()),
						h.textField
							.label("Status")
							.placeholder("What's your status?")
							.value(model.message)
							.on("change", (payload) => SetStatusMessage.ChangedMessage({ payload })),
					),
				// HAZEL-GAP(p4-emoji-picker-custom): today's picker also lists the organization's custom emojis.
				h.emojiPicker
					.open(model.emojiPickerOpen)
					.on("select", ({ emoji }) => SetStatusMessage.PickedEmoji({ emoji }))
					.on("dismiss", SetStatusMessage.DismissedEmojiPicker()),
				h.select
					.label("Clear after")
					.options(EXPIRATIONS.map((option) => ({ value: option.value, label: expirationLabel(model, option) })))
					.value(model.expiration)
					.on("change", ({ value }) => SetStatusMessage.ChangedExpiration({ value })),
				model.expiration === "custom"
					? h.stack
							.axis("horizontal")
							.children(
								h.datePicker
									.label("Date")
									.value(model.customDate ?? undefined)
									.min(today)
									.on("change", ({ value }) => SetStatusMessage.ChangedCustomDate({ value })),
								h.datePicker
									.label("Time")
									.granularity("time")
									.value(model.customTime ?? undefined)
									.on("change", ({ value }) => SetStatusMessage.ChangedCustomTime({ value })),
							)
					: null,
				// HAZEL-GAP(p4-toggle-box): today's switch sits in a muted, bordered box.
				h.toggle
					.label("Pause notifications")
					.description("Don't receive notifications while this status is set")
					.checked(model.pauseNotifications)
					.on("change", ({ checked }) => SetStatusMessage.ToggledPauseNotifications({ checked })),
				h.divider,
				h.stack
					.density("compact")
					.children(
						h.text.role("caption").tone("muted").children("Quick presets"),
						h.stack
							.axis("horizontal")
							.density("compact")
							.children(
								...STATUS_PRESETS.map((preset) =>
									h.button
										.key(preset.message)
										.label(`${preset.emoji} ${preset.message}`)
										.variant("chip")
										.size("small")
										.selected(model.emoji === preset.emoji && model.message.text === preset.message)
										.on("press", SetStatusMessage.PressedPreset(preset)),
								),
							),
					),
			)
			// HAZEL-GAP(p4-dialog-actions-leading): today "Clear status" sits at the footer's start, apart.
			.actions(
				hasExistingStatus(model)
					? h.button
							.label("Clear status")
							.variant("danger")
							.disabled(model.submitting)
							.on("press", SetStatusMessage.PressedClear())
					: null,
				h.button.label("Cancel").variant("outline").on("press", SetStatusMessage.PressedCancel()),
				h.button
					.label(model.submitting ? "Saving..." : "Save")
					.disabled(isSaveDisabled(model))
					.on("press", SetStatusMessage.PressedSave()),
			)
	},
})

export const SetStatusModal = SetStatusModalNoDeps.pipe(
	Component.provide(Layer.mergeAll(SaveStatus.layer, ClearStatus.layer)),
)
