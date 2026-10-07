import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { IconArrowPath, IconWarning } from "../../../icons"
import { button } from "../../../ui/button"
import { dialog, dialogClose, dialogDescription, dialogFooter, dialogHeader, dialogTitle } from "../../../ui/dialog"
import * as Modal from "../../../ui/modal"
import { Message } from "./message"
import type { Model } from "./model"

/**
 * The delete and restore confirmations: controlled `<Modal><ModalContent>` with a `<Dialog>`
 * inside, so React Aria renders a dialog within the ModalContent's dialog.
 */

const toDeleteMessage = (message: Modal.Message) => Message.GotDeleteModalMessage({ message })
const toRestoreMessage = (message: Modal.Message) => Message.GotRestoreModalMessage({ message })

const innerTitleId = (modalId: string) => `${modalId}-inner-title`

const innerDialog = (h: HtmlBuilder<Message>, modalId: string, children: ReadonlyArray<Html>): Html =>
	dialog(h, { id: Modal.dialogId(modalId), role: "dialog", labelledBy: innerTitleId(modalId) }, children)

const iconBoxClass = {
	danger: "flex size-12 items-center justify-center rounded-lg border border-danger/10 bg-danger/5",
	primary: "flex size-12 items-center justify-center rounded-lg border border-primary/10 bg-primary/5",
}

const iconBox = (h: HtmlBuilder<Message>, tone: "danger" | "primary", icon: Html): Html =>
	h.div([h.Class(iconBoxClass[tone])], [icon])

const footer = (
	h: HtmlBuilder<Message>,
	closeAttributes: ReadonlyArray<ChildAttribute>,
	confirm: Html,
): Html => dialogFooter(h, [dialogClose(h, closeAttributes, ["Cancel"], "secondary"), confirm])

export const deleteEmojiModal = (h: HtmlBuilder<Message>, model: Model): Html => {
	const id = model.deleteModal.id
	return h.submodel({
		slotId: id,
		model: model.deleteModal,
		view: Modal.view,
		viewInputs: {
			toTrigger: (_attributes, overlay) => overlay,
			toContent: (closeAttributes) => [
				innerDialog(h, id, [
					dialogHeader(h, {}, [
						iconBox(h, "danger", IconWarning(h, { className: "size-6 text-danger" })),
						dialogTitle(h, { id: innerTitleId(id) }, "Delete custom emoji"),
						dialogDescription(h, [
							"Are you sure you want to delete ",
							h.strong([], [":", model.deleteTarget?.name ?? "", ":"]),
							"? Messages that use this emoji will show the text code instead.",
						]),
					]),
					footer(
						h,
						closeAttributes,
						button(h, { intent: "danger", onPress: Message.ClickedConfirmDelete() }, ["Delete emoji"]),
					),
				]),
			],
			size: "md",
		},
		toParentMessage: toDeleteMessage,
	})
}

const imageTile = (h: HtmlBuilder<Message>, src: string, label: string): Html =>
	h.div(
		[h.Class("flex flex-col items-center gap-1.5")],
		[
			h.div(
				[h.Class("flex size-16 items-center justify-center overflow-hidden rounded-lg bg-secondary")],
				[h.img([h.Src(src), h.Alt(label), h.Class("size-16 object-contain")])],
			),
			h.span([h.Class("text-muted-fg text-xs")], [label]),
		],
	)

export const restoreEmojiModal = (h: HtmlBuilder<Message>, model: Model): Html => {
	const id = model.restoreModal.id
	const target = model.restoreTarget
	const imagesAreDifferent = target !== null && target.imageUrl !== target.newImageUrl
	return h.submodel({
		slotId: id,
		model: model.restoreModal,
		view: Modal.view,
		viewInputs: {
			toTrigger: (_attributes, overlay) => overlay,
			toContent: (closeAttributes) => [
				innerDialog(h, id, [
					dialogHeader(h, {}, [
						iconBox(h, "primary", IconArrowPath(h, { className: "size-6 text-primary" })),
						dialogTitle(h, { id: innerTitleId(id) }, "Restore deleted emoji"),
						dialogDescription(h, [
							"An emoji named ",
							h.strong([], [":", target?.name ?? "", ":"]),
							" was previously deleted. Would you like to restore it with your new image?",
						]),
					]),
					...(imagesAreDifferent
						? [
								h.div(
									[h.Class("flex items-center justify-center gap-6 py-2")],
									[
										imageTile(h, target.imageUrl, "Previous"),
										h.span([h.Class("text-muted-fg")], ["→"]),
										imageTile(h, target.newImageUrl, "New"),
									],
								),
							]
						: []),
					footer(
						h,
						closeAttributes,
						button(h, { intent: "primary", onPress: Message.ClickedConfirmRestore() }, [
							"Restore with new image",
						]),
					),
				]),
			],
			size: "md",
		},
		toParentMessage: toRestoreMessage,
	})
}
