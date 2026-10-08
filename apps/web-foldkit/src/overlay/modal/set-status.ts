import { OrganizationId, UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Effect, Option, Schema, Stream } from "effect"
import { Command, Subscription } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { userPresenceStatusCollection } from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import * as EmojiDialog from "../../emoji-picker/dialog"
import { customEmojisStream } from "../../page/chat/lookup-data"
import type { Shared } from "../../page/contract"
import { HazelRpc } from "../../rpc"
import * as DatePicker from "../../ui/date-picker"
import * as Segments from "../../ui/date-segments"
import * as Select from "../../ui/select"
import { toastForCause } from "../action"
import { closed, completed, ModalOutMessage, successToast } from "../out-message"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalSubscriptionInput } from "./contract"
import { initFrame, isFrameClosed } from "./frame"
import {
	customDateOf,
	EXPIRATION_OPTIONS,
	expirationDate,
	expirationOf,
	ID,
	isSaveDisabled,
	Message,
	Model,
	nextHourValue,
	type Presence,
	todayValue,
	withExpirationItems,
} from "./set-status-model"
import { view } from "./set-status-view"

/**
 * `components/modals/set-status-modal.tsx` (user menu). Reads the presence row like `usePresence()`
 * and calls the same `userPresenceStatus.update` / `clearStatus` RPCs as its setters.
 */

const SaveStatus = Command.define("SaveStatus", {
	args: {
		statusEmoji: Schema.NullOr(Schema.String),
		customMessage: Schema.NullOr(Schema.String),
		expiration: Schema.String,
		customDate: Schema.NullOr(Schema.String),
		customTime: Schema.NullOr(Schema.String),
		suppressNotifications: Schema.Boolean,
	},
	messages: [Message.SucceededSaveStatus, Message.FailedSaveStatus],
	execute: ({ expiration, customDate, customTime, ...fields }) =>
		Effect.gen(function* () {
			const statusExpiresAt = yield* Effect.sync(() =>
				expirationDate(expiration, customDate, customTime, new Date()),
			)
			const client = yield* HazelRpc
			yield* client("userPresenceStatus.update", { ...fields, statusExpiresAt })
			return Message.SucceededSaveStatus()
		}).pipe(Effect.catchCause((cause) => Effect.succeed(Message.FailedSaveStatus({ toast: toastForCause(cause) })))),
})

const ClearStatus = Command.define("ClearStatus", {
	messages: [Message.SucceededClearStatus, Message.FailedClearStatus],
	execute: Effect.gen(function* () {
		const client = yield* HazelRpc
		yield* client("userPresenceStatus.clearStatus", {})
		return Message.SucceededClearStatus()
	}).pipe(Effect.catchCause((cause) => Effect.succeed(Message.FailedClearStatus({ toast: toastForCause(cause) })))),
})

type Return = ModalReturn<Model, Message>

const expirationChanged = (model: Model, result: ReturnType<typeof Select.update>, shared: Shared): Return => {
	const next = modifyFields(model, { expiration: () => result.model })
	// Picking "custom" defaults the date to today and the time to the next hour.
	const isCustom = result.outMessage !== undefined && result.outMessage.key === "custom"
	const withDefaults = isCustom
		? modifyFields(next, {
				customDate: (current) => {
					const today = todayValue(shared.nowMs)
					return current ?? DatePicker.init({ id: `${ID}-date`, today, value: today, minValue: today })
				},
				customTime: (current) =>
					current ?? Segments.init({ id: `${ID}-time`, kind: "time", value: nextHourValue(shared.nowMs) }),
			})
		: next
	return {
		model: withExpirationItems(withDefaults),
		commands: Command.mapMessages(result.commands, (message) => Message.GotExpirationMessage({ message })),
	}
}

const customDateChanged = (model: Model, message: DatePicker.Message): Return => {
	if (model.customDate === null) return { model }
	const result = DatePicker.update(model.customDate, message)
	return {
		model: withExpirationItems({ ...model, customDate: result.model }),
		commands: Command.mapMessages(result.commands ?? [], (child) =>
			Message.GotCustomDateMessage({ message: child }),
		),
	}
}

/** `EmojiPickerDialog onEmojiSelect={(e) => setEmoji(e.emoji)}`; the dialog closes itself. */
const emojiPickerChanged = (model: Model, message: EmojiDialog.Message): Return => {
	const result = EmojiDialog.update(model.emojiPicker, message)
	return {
		model: modifyFields(model, {
			emojiPicker: () => result.model,
			emoji: (emoji) => (result.outMessage === undefined ? emoji : result.outMessage.emoji),
		}),
		commands: Command.mapMessages(result.commands ?? [], (child) =>
			Message.GotEmojiPickerMessage({ message: child }),
		),
	}
}

const segmentsChanged = (
	model: Model,
	field: "customTime",
	message: Segments.Message,
	toMessage: (message: Segments.Message) => Message,
): Return => {
	const current = model[field]
	if (current === null) return { model }
	const result = Segments.update(current, message)
	return {
		model: withExpirationItems({ ...model, [field]: result.model }),
		commands: Command.mapMessages(result.commands, toMessage),
	}
}

/**
 * Legacy seeds its `useState`s when `UserMenu` mounts, before the presence row has synced, and
 * `handleOpenChange` never runs for a state-driven open: the form starts empty. Presence only
 * decides "Clear status".
 */
const presenceUpdated = (model: Model, presence: Presence | null): Return => ({
	model: modifyFields(model, { presence: () => presence }),
})

const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) => (isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model }),
		GotExpirationMessage: ({ message }) => expirationChanged(model, Select.update(model.expiration, message), shared),
		GotCustomDateMessage: ({ message }) => customDateChanged(model, message),
		GotEmojiPickerMessage: ({ message }) => emojiPickerChanged(model, message),
		UpdatedCustomEmojis: ({ emojis }) => ({ model: modifyFields(model, { customEmojis: () => emojis }) }),
		GotCustomTimeMessage: ({ message }) =>
			segmentsChanged(model, "customTime", message, (child) => Message.GotCustomTimeMessage({ message: child })),
		UpdatedPresence: ({ presence }) => presenceUpdated(model, presence),
		ChangedMessage: ({ value }) => ({ model: modifyFields(model, { message: () => value }) }),
		ToggledPauseNotifications: ({ isSelected }) => ({
			model: modifyFields(model, { pauseNotifications: () => isSelected }),
		}),
		ClickedPreset: ({ emoji, message }) => ({
			model: modifyFields(model, { emoji: () => emoji, message: () => message }),
		}),
		ClickedCancel: () => ({ model, outMessage: closed }),
		// `setCustomStatus` / `clearCustomStatus` do nothing without a signed-in user.
		ClickedSave: () =>
			isSaveDisabled(model) || shared.currentUser === null
				? { model }
				: {
						model: modifyFields(model, { isSubmitting: () => true }),
						commands: [
							SaveStatus({
								statusEmoji: model.emoji,
								customMessage: model.message || null,
								expiration: expirationOf(model),
								customDate: customDateOf(model),
								customTime: model.customTime?.committed ?? null,
								suppressNotifications: model.pauseNotifications,
							}),
						],
					},
		ClickedClear: () =>
			model.isSubmitting || shared.currentUser === null
				? { model }
				: { model: modifyFields(model, { isSubmitting: () => true }), commands: [ClearStatus()] },
		SucceededSaveStatus: () => ({ model, outMessage: completed({ toast: successToast("Status updated") }) }),
		FailedSaveStatus: ({ toast }) => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
		SucceededClearStatus: () => ({ model, outMessage: completed({ toast: successToast("Status cleared") }) }),
		FailedClearStatus: ({ toast }) => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
	})

interface PresenceRow {
	readonly statusEmoji?: string | null
	readonly customMessage?: string | null
	readonly suppressNotifications?: boolean
}

/** `currentUserPresenceAtomFamily`: the user's newest presence row. */
const dataSubscriptions = Subscription.make<ModalSubscriptionInput<Model>, Message>()((entry) => ({
	// `CustomEmojiSection`'s `customEmojisForOrgAtomFamily`.
	customEmojis: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: (input) => ({ organizationId: input.shared.organization?.id ?? null }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: customEmojisStream(organizationId, (emojis) => Message.UpdatedCustomEmojis({ emojis })),
		},
	),
	presence: entry(
		{ userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: (input) => ({ userId: input.shared.currentUser?.id ?? null }),
			dependenciesToStream: ({ userId }) =>
				userId === null
					? Stream.empty
					: liveQueryStream<PresenceRow, Message>(
							(q) =>
								q
									.from({ presence: userPresenceStatusCollection })
									.where(({ presence }) => eq(presence.userId, userId))
									.orderBy(({ presence }) => presence.updatedAt, "desc")
									.findOne(),
							(rows) => {
								const row = rows[0]
								return Message.UpdatedPresence({
									presence:
										row === undefined
											? null
											: {
													statusEmoji: row.statusEmoji ?? null,
													customMessage: row.customMessage ?? null,
													suppressNotifications: row.suppressNotifications ?? false,
												},
								})
							},
						),
		},
	),
}))

/** The custom date's calendar (hover, press and focus modality) while "custom" is picked. */
const datePickerSubscriptions = Subscription.lift(DatePicker.subscriptions)<ModalSubscriptionInput<Model>, Message>({
	read: (input) => Option.fromNullishOr(input.model.customDate),
	toParentMessage: (message) => Message.GotCustomDateMessage({ message }),
})

const subscriptions = Subscription.aggregate<ModalSubscriptionInput<Model>, Message>()(
	dataSubscriptions,
	datePickerSubscriptions,
)

export const modal = defineModal(
	"SetStatus",
	{ request: Requests.SetStatus, Model, Message },
	{
		init: () => ({
			model: {
				frame: initFrame(ID),
				presence: null,
				emoji: null,
				emojiPicker: EmojiDialog.init(`${ID}-emoji-picker`),
				customEmojis: [],
				message: "",
				expiration: Select.init({
					id: `${ID}-expiration-select`,
					items: EXPIRATION_OPTIONS.map((option) => Select.item(option.id, option.label)),
					selectedKey: "never",
				}),
				customDate: null,
				customTime: null,
				pauseNotifications: false,
				isSubmitting: false,
			},
		}),
		update,
		view,
		subscriptions,
	},
)
