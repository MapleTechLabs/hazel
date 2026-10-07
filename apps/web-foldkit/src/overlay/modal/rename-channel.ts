import { ChannelId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Effect, Schema } from "effect"
import { Command, Submodel, Subscription } from "foldkit"
import * as Dom from "foldkit/dom"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { updateChannelAction } from "~/db/actions"
import { channelCollection } from "~/db/collections"
import type { UserErrorMessage } from "~/lib/error-messages"
import { liveQueryStream } from "../../data/live-query"
import { button } from "../../ui/button"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { textField, textFieldIds } from "../../ui/text-field"
import { runAction, toastForCause } from "../action"
import { closed, completed, ModalOutMessage, successToast } from "../out-message"
import { ToastRequest } from "../toasts"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalSubscriptionInput, type ModalViewInputs } from "./contract"
import {
	Frame,
	FrameMessage,
	frameView,
	initFrame,
	isFrameClosed,
	modalDescription,
	modalTitle,
} from "./frame"

/**
 * `components/modals/rename-channel-modal.tsx`. `rename-thread.ts` reuses these parts: the two
 * legacy modals differ only in copy.
 */

const ChannelRow = Schema.Struct({ id: ChannelId, name: Schema.String })

export const Model = Schema.Struct({
	frame: Frame,
	channelId: ChannelId,
	/** The live-queried channel (legacy `useLiveQuery`); null until it loads. */
	channel: Schema.NullOr(ChannelRow),
	name: Schema.String,
	/** tanstack-form follows changed `defaultValues` until the field is edited. */
	isTouched: Schema.Boolean,
	isSubmitting: Schema.Boolean,
})
type Model = typeof Model.Type

export const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	UpdatedChannel: { channel: Schema.NullOr(ChannelRow) },
	ChangedName: { value: Schema.String },
	ClickedCancel: {},
	SubmittedForm: {},
	SucceededRenameChannel: {},
	FailedRenameChannel: { toast: ToastRequest },
	CompletedFocusInput: {},
})
type Message = typeof Message.Type

export interface RenameCopy {
	readonly id: string
	readonly title: string
	readonly description: string
	readonly label: string
	readonly placeholder: string
	readonly successMessage: string
	readonly notFound: UserErrorMessage
}

const RenameChannel = Command.define("RenameChannel", {
	args: {
		channelId: ChannelId,
		name: Schema.String,
		notFoundTitle: Schema.String,
		notFoundDescription: Schema.String,
	},
	messages: [Message.SucceededRenameChannel, Message.FailedRenameChannel],
	execute: ({ channelId, name, notFoundTitle, notFoundDescription }) =>
		runAction(updateChannelAction, { channelId, name }).pipe(
			Effect.as(Message.SucceededRenameChannel()),
			Effect.catchCause((cause) =>
				Effect.succeed(
					Message.FailedRenameChannel({
						toast: toastForCause(cause, {
							ChannelNotFoundError: {
								title: notFoundTitle,
								description: notFoundDescription,
								isRetryable: false,
							},
						}),
					}),
				),
			),
		),
})

/** The Input's `autoFocus`, once the frame has moved focus into the dialog. */
const FocusInput = Command.define("FocusInput", {
	args: { selector: Schema.String },
	messages: [Message.CompletedFocusInput],
	execute: ({ selector }) =>
		Dom.focus(selector).pipe(Effect.ignoreCause, Effect.as(Message.CompletedFocusInput())),
})

type Return = ModalReturn<Model, Message>

const inputId = (copy: RenameCopy) => textFieldIds(`${copy.id}-name`).input

const submitted = (model: Model, copy: RenameCopy): Return => {
	if (model.channel === null || model.isSubmitting) return { model }
	const trimmedName = model.name.trim()
	if (trimmedName === model.channel.name) return { model, outMessage: closed }
	return {
		model: modifyFields(model, { isSubmitting: () => true }),
		commands: [
			RenameChannel({
				channelId: model.channel.id,
				name: trimmedName,
				notFoundTitle: copy.notFound.title,
				notFoundDescription: copy.notFound.description ?? "",
			}),
		],
	}
}

const makeUpdate =
	(copy: RenameCopy) =>
	(model: Model, message: Message): Return =>
		Message.match<Return>(message, {
			GotFrameMessage: ({ message }) => {
				if (isFrameClosed(model.frame, message)) return { model, outMessage: closed }
				return message._tag === "CompletedPortalModal"
					? { model, commands: [FocusInput({ selector: `#${inputId(copy)}` })] }
					: { model }
			},
			UpdatedChannel: ({ channel }) => ({
				model: modifyFields(model, {
					channel: () => channel,
					name: (name) => (model.isTouched ? name : (channel?.name ?? "")),
				}),
			}),
			ChangedName: ({ value }) => ({
				model: modifyFields(model, { name: () => value, isTouched: () => true }),
			}),
			ClickedCancel: () => ({ model, outMessage: closed }),
			SubmittedForm: () => submitted(model, copy),
			SucceededRenameChannel: () => ({
				model,
				outMessage: completed({ toast: successToast(copy.successMessage) }),
			}),
			FailedRenameChannel: ({ toast }) => ({
				model: modifyFields(model, { isSubmitting: () => false }),
				outMessage: ModalOutMessage.RequestedToast({ toast }),
			}),
			CompletedFocusInput: () => ({ model }),
		})

const makeView = (copy: RenameCopy) =>
	Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
		frameView(
			h,
			model.frame,
			{ size: "lg" },
			() => [
				dialogHeader(h, {}, [
					modalTitle(h, model.frame, copy.title),
					modalDescription(h, copy.description),
				]),
				h.form(
					[h.OnSubmit(Message.SubmittedForm())],
					[
						dialogBody(
							h,
							[
								textField(
									h,
									{
										id: `${copy.id}-name`,
										value: model.name,
										onInput: (value) => Message.ChangedName({ value }),
									},
									(field) => [
										field.label([copy.label]),
										field.input({
											placeholder: copy.placeholder,
											attributes: [h.Attribute("aria-invalid", "false")],
										}),
									],
								),
							],
							"flex flex-col gap-4",
						),
						dialogFooter(h, [
							button(h, { intent: "outline", onPress: Message.ClickedCancel() }, ["Cancel"]),
							button(
								h,
								{
									intent: "primary",
									isDisabled: model.isSubmitting,
									attributes: [h.Type("submit")],
								},
								[model.isSubmitting ? "Saving..." : "Rename"],
							),
						]),
					],
				),
			],
			(message) => Message.GotFrameMessage({ message }),
		),
	)

const subscriptions = Subscription.make<ModalSubscriptionInput<Model>, Message>()((entry) => ({
	channel: entry(
		{ channelId: ChannelId },
		{
			modelToDependencies: (input) => ({ channelId: input.model.channelId }),
			dependenciesToStream: ({ channelId }) =>
				liveQueryStream<typeof ChannelRow.Type, Message>(
					(q) => q.from({ channel: channelCollection }).where((t) => eq(t.channel.id, channelId)),
					(rows) => {
						const row = rows[0]
						return Message.UpdatedChannel({
							channel: row ? { id: row.id, name: row.name } : null,
						})
					},
				),
		},
	),
}))

/** Everything but `defineModal`, which needs each modal's own tag and request field. */
export const renameModalSpec = (copy: RenameCopy) => ({
	init: (channelId: ChannelId): Return => ({
		model: {
			frame: initFrame(copy.id),
			channelId,
			channel: null,
			name: "",
			isTouched: false,
			isSubmitting: false,
		},
	}),
	update: makeUpdate(copy),
	view: makeView(copy),
	subscriptions,
})

const spec = renameModalSpec({
	id: "rename-channel-modal",
	title: "Rename Channel",
	description: "Enter a new name for this channel",
	label: "Channel Name",
	placeholder: "general",
	successMessage: "Channel renamed successfully",
	notFound: {
		title: "Channel not found",
		description: "This channel may have been deleted.",
		isRetryable: false,
	},
})

export const modal = defineModal(
	"RenameChannel",
	{ request: Requests.RenameChannel, Model, Message },
	{ ...spec, init: ({ channelId }) => spec.init(channelId) },
)
