import type { Html, HtmlBuilder } from "foldkit/html"
import { IconWarning } from "../../../icons"
import { button } from "../../../ui/button"
import { dialogBody, dialogFooter, dialogHeader, dialogTitle } from "../../../ui/dialog"
import * as Field from "../../../ui/field"
import * as Modal from "../../../ui/modal"
import * as ConfirmAction from "../../shared/confirm-action"
import { textField } from "../../../ui/text-field"
import type { Organization } from "../../../session"
import { Message } from "./message"
import type { Model } from "./model"

/** Port of `components/modals/delete-workspace-modal.tsx` (a page-local controlled modal). */

const toDeleteModalMessage = (message: Modal.Message) =>
	Message.GotDeleteConfirmMessage({ message: ConfirmAction.toModalMessage(message) })

export const deleteWorkspaceModal = (
	h: HtmlBuilder<Message>,
	model: Model,
	organization: Organization,
): Html => {
	const isDeleting = ConfirmAction.isRunning(model.deleteConfirm)
	return h.submodel({
		slotId: "delete-workspace-modal",
		model: model.deleteConfirm.modal,
		view: Modal.view,
		viewInputs: {
			toContent: () => [
				dialogHeader(h, {}, [
					h.div(
						[h.Class("flex items-center gap-2")],
						[
							h.div(
								[
									h.Class(
										"flex size-10 items-center justify-center rounded-full bg-danger/10",
									),
								],
								[IconWarning(h, { className: "size-5 text-danger" })],
							),
							dialogTitle(
								h,
								{ id: Modal.titleId(model.deleteConfirm.modal.id) },
								"Delete workspace",
							),
						],
					),
					Field.description(h, {}, [
						"This action ",
						h.strong([], ["cannot be undone"]),
						". This will permanently delete the workspace",
						" ",
						h.strong([], [organization.name]),
						", all channels, messages, and remove all member access.",
					]),
				]),
				dialogBody(h, [
					textField(
						h,
						{
							id: "delete-workspace-confirmation",
							value: model.confirmationText,
							onInput: (value) => Message.ChangedConfirmation({ value }),
							className: "w-full",
						},
						(parts) => [
							parts.label(["Type ", h.strong([], [organization.name]), " to confirm"]),
							parts.input({
								placeholder: organization.name,
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
						{ intent: "outline", isDisabled: isDeleting, onPress: Message.ClickedCancelDelete() },
						["Cancel"],
					),
					button(
						h,
						{
							intent: "danger",
							isDisabled: model.confirmationText !== organization.name || isDeleting,
							isPending: isDeleting,
							onPress: Message.ClickedConfirmDelete(),
						},
						[isDeleting ? "Deleting..." : "Delete workspace"],
					),
				]),
			],
			size: "lg",
		},
		toParentMessage: toDeleteModalMessage,
	})
}
