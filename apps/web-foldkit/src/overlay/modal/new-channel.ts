import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { createChannelAction } from "~/db/actions"
import { IconHashtag } from "../../icons"
import type { Shared } from "../../page/contract"
import { button } from "../../ui/button"
import { checkbox } from "../../ui/checkbox"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { label } from "../../ui/field"
import { inputGroup } from "../../ui/input"
import * as Select from "../../ui/select"
import { view as selectView } from "../../ui/select-view"
import { textField } from "../../ui/text-field"
import { runAction, toastForCause } from "../action"
import { closed, completed, ModalOutMessage, successToast } from "../out-message"
import { ToastRequest } from "../toasts"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalDescription, modalTitle } from "./frame"

/** `components/modals/create-channel-modal.tsx` (legacy `useModal("new-channel")`). */

const ChannelType = Schema.Literals(["public", "private"])

const Model = Schema.Struct({
	frame: Frame,
	name: Schema.String,
	/** Validated on change only (tanstack-form `onChange`), so it is null until the first edit. */
	nameError: Schema.NullOr(Schema.String),
	channelType: Select.Model,
	addAllMembers: Schema.Boolean,
	isSubmitting: Schema.Boolean,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	GotChannelTypeMessage: { message: Select.Message },
	ChangedName: { value: Schema.String },
	ToggledAddAllMembers: { isSelected: Schema.Boolean },
	ClickedCancel: {},
	SubmittedForm: {},
	SucceededCreateChannel: { channelId: ChannelId },
	FailedCreateChannel: { toast: ToastRequest },
})
type Message = typeof Message.Type

const CreateChannel = Command.define("CreateChannel", {
	args: {
		name: Schema.String,
		type: ChannelType,
		organizationId: OrganizationId,
		currentUserId: UserId,
		addAllMembers: Schema.Boolean,
	},
	messages: [Message.SucceededCreateChannel, Message.FailedCreateChannel],
	execute: (args) =>
		runAction(createChannelAction, { ...args, icon: null, parentChannelId: null }).pipe(
			Effect.map((result) => Message.SucceededCreateChannel({ channelId: result.data.channelId })),
			Effect.catchCause((cause) => Effect.succeed(Message.FailedCreateChannel({ toast: toastForCause(cause) }))),
		),
})

/** arktype `name: "string > 2"`, worded as arktype reports it. */
const validateName = (name: string) =>
	name.length > 2 ? null : `name must be more than length 2 (was ${name.length})`

const ID = "create-channel-modal"

type Return = ModalReturn<Model, Message>

const submitted = (model: Model, shared: Shared): Return => {
	const nameError = validateName(model.name)
	if (nameError !== null) return { model: modifyFields(model, { nameError: () => nameError }) }
	if (model.isSubmitting || shared.currentUser === null || shared.organization === null || shared.orgSlug === null)
		return { model }
	return {
		model: modifyFields(model, { isSubmitting: () => true }),
		commands: [
			CreateChannel({
				name: model.name,
				type: Option.getOrElse(model.channelType.selectedKey, () => "public") === "private" ? "private" : "public",
				organizationId: shared.organization.id,
				currentUserId: shared.currentUser.id,
				addAllMembers: model.addAllMembers,
			}),
		],
	}
}

const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) => (isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model }),
		GotChannelTypeMessage: ({ message }) => {
			const result = Select.update(model.channelType, message)
			return {
				model: modifyFields(model, { channelType: () => result.model }),
				commands: Command.mapMessages(result.commands, (child) => Message.GotChannelTypeMessage({ message: child })),
			}
		},
		ChangedName: ({ value }) => ({
			model: modifyFields(model, { name: () => value, nameError: () => validateName(value) }),
		}),
		ToggledAddAllMembers: ({ isSelected }) => ({ model: modifyFields(model, { addAllMembers: () => isSelected }) }),
		ClickedCancel: () => ({ model, outMessage: closed }),
		SubmittedForm: () => submitted(model, shared),
		SucceededCreateChannel: ({ channelId }) => ({
			model,
			outMessage: completed({
				href: `/${shared.orgSlug ?? ""}/chat/${channelId}`,
				toast: successToast("Channel created successfully"),
			}),
		}),
		FailedCreateChannel: ({ toast }) => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
	})

const toChannelTypeMessage = (message: Select.Message): Message => Message.GotChannelTypeMessage({ message })

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "lg" },
		() => [
			dialogHeader(h, {}, [
				modalTitle(h, model.frame, "Create a new Channel"),
				modalDescription(h, "Give your channel a name and type to create a new channel."),
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
									id: `${ID}-name`,
									value: model.name,
									isInvalid: model.nameError !== null,
									onInput: (value) => Message.ChangedName({ value }),
								},
								(field) => [
									field.label(["Channel Name"]),
									inputGroup(h, { attributes: [h.Role("presentation")] }, [
										IconHashtag(h),
										field.input({
											placeholder: "general",
											attributes: [h.Attribute("aria-invalid", model.nameError !== null ? "true" : "false")],
										}),
									]),
									...(model.nameError === null ? [] : [field.fieldError([model.nameError])]),
								],
							),
							label(h, {}, ["Channel Type"]),
							h.submodel({
								slotId: `${ID}-type`,
								model: model.channelType,
								view: selectView,
								viewInputs: {},
								toParentMessage: toChannelTypeMessage,
							}),
							checkbox(
								h,
								{
									id: `${ID}-add-all`,
									isSelected: model.addAllMembers,
									onChange: (isSelected) => Message.ToggledAddAllMembers({ isSelected }),
								},
								"Add all members to this channel",
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
								isDisabled: model.nameError !== null || model.isSubmitting,
								attributes: [h.Type("submit")],
							},
							[model.isSubmitting ? "Creating..." : "Create channel"],
						),
					]),
				],
			),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)

export const modal = defineModal(
	"NewChannel",
	{ request: {}, Model, Message },
	{
		init: () => ({
			model: {
				frame: initFrame(ID),
				name: "",
				nameError: null,
				channelType: Select.init({
					id: `${ID}-type`,
					items: [Select.item("public", "Public"), Select.item("private", "Private")],
					selectedKey: "public",
				}),
				addAllMembers: false,
				isSubmitting: false,
			},
		}),
		update,
		view,
	},
)
