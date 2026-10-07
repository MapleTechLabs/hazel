import { UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Effect, Schema, Stream } from "effect"
import { Command, Subscription } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { userPresenceStatusCollection } from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import type { Shared } from "../../page/contract"
import { HazelRpc } from "../../rpc"
import * as Segments from "../../ui/date-segments"
import * as Select from "../../ui/select"
import { toastForCause } from "../action"
import { closed, completed, ModalOutMessage, successToast } from "../out-message"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalSubscriptionInput } from "./contract"
import { initFrame, isFrameClosed } from "./frame"
import {
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
				customDate: (current) =>
					current ?? Segments.init({ id: `${ID}-date`, kind: "date", value: todayValue(shared.nowMs) }),
				customTime: (current) =>
					current ?? Segments.init({ id: `${ID}-time`, kind: "time", value: nextHourValue(shared.nowMs) }),
			})
		: next
	return {
		model: withExpirationItems(withDefaults),
		commands: Command.mapMessages(result.commands, (message) => Message.GotExpirationMessage({ message })),
	}
}

const segmentsChanged = (
	model: Model,
	field: "customDate" | "customTime",
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

const presenceUpdated = (model: Model, presence: Presence | null): Return => ({
	model: model.hasSeeded
		? modifyFields(model, { presence: () => presence })
		: modifyFields(model, {
				presence: () => presence,
				hasSeeded: () => true,
				emoji: () => presence?.statusEmoji ?? null,
				message: () => presence?.customMessage ?? "",
				pauseNotifications: () => presence?.suppressNotifications ?? false,
			}),
})

const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) => (isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model }),
		GotExpirationMessage: ({ message }) => expirationChanged(model, Select.update(model.expiration, message), shared),
		GotCustomDateMessage: ({ message }) =>
			segmentsChanged(model, "customDate", message, (child) => Message.GotCustomDateMessage({ message: child })),
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
								customDate: model.customDate?.committed ?? null,
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
const subscriptions = Subscription.make<ModalSubscriptionInput<Model>, Message>()((entry) => ({
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

export const modal = defineModal(
	"SetStatus",
	{ request: Requests.SetStatus, Model, Message },
	{
		init: () => ({
			model: {
				frame: initFrame(ID),
				presence: null,
				hasSeeded: false,
				emoji: null,
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
