import { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { IconWarning } from "../../icons"
import { HazelRpc } from "../../rpc"
import { button } from "../../ui/button"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { description } from "../../ui/field"
import { textField } from "../../ui/text-field"
import { toastForCause } from "../action"
import { closed, completed, ModalOutMessage, successToast } from "../out-message"
import { ToastRequest } from "../toasts"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalTitle } from "./frame"

/** `components/modals/delete-workspace-modal.tsx`; on success the settings page navigated to `/`. */

const Model = Schema.Struct({
	organizationId: OrganizationId,
	organizationName: Schema.String,
	frame: Frame,
	confirmationText: Schema.String,
	isDeleting: Schema.Boolean,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ChangedConfirmationText: { value: Schema.String },
	ClickedCancel: {},
	ClickedDelete: {},
	SucceededDeleteWorkspace: {},
	FailedDeleteWorkspace: { toast: ToastRequest },
})
type Message = typeof Message.Type

const DeleteWorkspace = Command.define("DeleteWorkspace", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededDeleteWorkspace, Message.FailedDeleteWorkspace],
	execute: ({ organizationId }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			yield* client("organization.delete", { id: organizationId })
			return Message.SucceededDeleteWorkspace()
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.succeed(
					Message.FailedDeleteWorkspace({
						toast: toastForCause(cause, {
							OrganizationNotFoundError: {
								title: "Workspace not found",
								description: "This workspace may have already been deleted.",
								isRetryable: false,
							},
							UnauthorizedError: {
								title: "Unauthorized",
								description: "You don't have permission to delete this workspace.",
								isRetryable: false,
							},
						}),
					}),
				),
			),
		),
})

type Return = ModalReturn<Model, Message>

const isConfirmed = (model: Model) => model.confirmationText === model.organizationName

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) =>
			isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model },
		ChangedConfirmationText: ({ value }) => ({
			model: modifyFields(model, { confirmationText: () => value }),
		}),
		ClickedCancel: () => ({ model, outMessage: closed }),
		ClickedDelete: () =>
			!isConfirmed(model) || model.isDeleting
				? { model }
				: {
						model: modifyFields(model, { isDeleting: () => true }),
						commands: [DeleteWorkspace({ organizationId: model.organizationId })],
					},
		// The settings page's `onDeleted` navigated to the root.
		SucceededDeleteWorkspace: () => ({
			model,
			outMessage: completed({ href: "/", toast: successToast("Workspace deleted successfully") }),
		}),
		FailedDeleteWorkspace: ({ toast }) => ({
			model: modifyFields(model, { isDeleting: () => false }),
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
	})

const ID = "delete-workspace-modal"

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "lg" },
		() => [
			dialogHeader(h, {}, [
				h.div(
					[h.Class("flex items-center gap-2")],
					[
						h.div(
							[h.Class("flex size-10 items-center justify-center rounded-full bg-danger/10")],
							[IconWarning(h, { className: "size-5 text-danger" })],
						),
						modalTitle(h, model.frame, "Delete workspace"),
					],
				),
				description(h, {}, [
					"This action ",
					h.strong([], ["cannot be undone"]),
					". This will permanently delete the workspace ",
					h.strong([], [model.organizationName]),
					", all channels, messages, and remove all member access.",
				]),
			]),
			dialogBody(h, [
				textField(
					h,
					{
						id: `${ID}-confirmation`,
						value: model.confirmationText,
						onInput: (value) => Message.ChangedConfirmationText({ value }),
						className: "w-full",
					},
					(field) => [
						field.label(["Type ", h.strong([], [model.organizationName]), " to confirm"]),
						field.input({
							placeholder: model.organizationName,
							attributes: [
								h.Attribute("autocomplete", "off"),
								h.Attribute("autocorrect", "off"),
								h.Attribute("spellcheck", "false"),
							],
						}),
					],
				),
			]),
			dialogFooter(h, [
				button(
					h,
					{ intent: "outline", isDisabled: model.isDeleting, onPress: Message.ClickedCancel() },
					["Cancel"],
				),
				button(
					h,
					{
						intent: "danger",
						isDisabled: !isConfirmed(model) || model.isDeleting,
						isPending: model.isDeleting,
						onPress: Message.ClickedDelete(),
					},
					[model.isDeleting ? "Deleting..." : "Delete workspace"],
				),
			]),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)

export const modal = defineModal(
	"DeleteWorkspace",
	{ request: Requests.DeleteWorkspace, Model, Message },
	{
		init: ({ organizationId, organizationName }) => ({
			model: {
				organizationId,
				organizationName,
				frame: initFrame(ID),
				confirmationText: "",
				isDeleting: false,
			},
		}),
		update,
		view,
	},
)
