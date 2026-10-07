import { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { createChannelSectionAction } from "~/db/actions"
import type { Shared } from "../../page/contract"
import { button } from "../../ui/button"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { textField } from "../../ui/text-field"
import { runAction, toastForCause } from "../action"
import { closed, completed, ModalOutMessage, successToast } from "../out-message"
import { ToastRequest } from "../toasts"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalTitle } from "./frame"

/** `components/modals/create-section-modal.tsx` (legacy `useModal("create-section")`). */

const Model = Schema.Struct({
	frame: Frame,
	name: Schema.String,
	/** tanstack-form `onChange` validation: null until the first edit or submit. */
	nameError: Schema.NullOr(Schema.String),
	isSubmitting: Schema.Boolean,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ChangedName: { value: Schema.String },
	ClickedCancel: {},
	SubmittedForm: {},
	SucceededCreateSection: {},
	FailedCreateSection: { toast: ToastRequest },
})
type Message = typeof Message.Type

const CreateSection = Command.define("CreateSection", {
	args: { name: Schema.String, organizationId: OrganizationId },
	messages: [Message.SucceededCreateSection, Message.FailedCreateSection],
	execute: (args) =>
		runAction(createChannelSectionAction, args).pipe(
			Effect.as(Message.SucceededCreateSection()),
			Effect.catchCause((cause) => Effect.succeed(Message.FailedCreateSection({ toast: toastForCause(cause) }))),
		),
})

/** arktype `name: "string > 1"`, worded as arktype reports it. */
const validateName = (name: string) =>
	name.length > 1 ? null : `name must be more than length 1 (was ${name.length})`

const ID = "create-section-modal"

type Return = ModalReturn<Model, Message>

const submitted = (model: Model, shared: Shared): Return => {
	const nameError = validateName(model.name)
	if (nameError !== null) return { model: modifyFields(model, { nameError: () => nameError }) }
	if (model.isSubmitting || shared.organization === null) return { model }
	return {
		model: modifyFields(model, { isSubmitting: () => true }),
		commands: [CreateSection({ name: model.name, organizationId: shared.organization.id })],
	}
}

const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) => (isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model }),
		ChangedName: ({ value }) => ({
			model: modifyFields(model, { name: () => value, nameError: () => validateName(value) }),
		}),
		ClickedCancel: () => ({ model, outMessage: closed }),
		SubmittedForm: () => submitted(model, shared),
		SucceededCreateSection: () => ({
			model,
			outMessage: completed({ toast: successToast("Section created successfully") }),
		}),
		FailedCreateSection: ({ toast }) => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
	})

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) => {
	const isInvalid = model.nameError !== null
	return frameView(
		h,
		model.frame,
		{ size: "md" },
		() => [
			dialogHeader(h, {}, [modalTitle(h, model.frame, "Create a new Section")]),
			h.form(
				[h.OnSubmit(Message.SubmittedForm())],
				[
					dialogBody(
						h,
						[
							// Legacy passes no `isInvalid` to the TextField: only the Input's aria-invalid
							// reflects the error and React Aria's FieldError never renders.
							textField(
								h,
								{ id: `${ID}-name`, value: model.name, onInput: (value) => Message.ChangedName({ value }) },
								(field) => [
									field.label(["Section Name"]),
									field.input({
										placeholder: "Design",
										attributes: [
											h.Attribute("aria-invalid", isInvalid ? "true" : "false"),
											...(isInvalid ? [h.DataAttribute("invalid", "true")] : []),
										],
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
							{ intent: "primary", isDisabled: isInvalid || model.isSubmitting, attributes: [h.Type("submit")] },
							[model.isSubmitting ? "Creating..." : "Create section"],
						),
					]),
				],
			),
		],
		(message) => Message.GotFrameMessage({ message }),
	)
})

export const modal = defineModal(
	"CreateSection",
	{ request: Requests.CreateSection, Model, Message },
	{
		init: () => ({ model: { frame: initFrame(ID), name: "", nameError: null, isSubmitting: false } }),
		update,
		view,
	},
)
