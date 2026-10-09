import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import type { ModalSize } from "~/components/ui/modal.styles"
import { dialogTitle } from "../../ui/dialog"
import { description } from "../../ui/field"
import * as KitModal from "../../ui/modal"

/**
 * Legacy controlled `<Modal isOpen onOpenChange><ModalContent>`: the kit Modal without a trigger.
 * A modal keeps a `frame` (kit Modal Model, always open) and closes when the frame reports closed.
 */

export const Frame = KitModal.Model
export type Frame = KitModal.Model
/** The frame's Message; modals import it `as FrameMessage` so their Got wrapper names the child Message. */
export const Message = KitModal.Message
export type Message = KitModal.Message
type FrameMessage = KitModal.Message

export const initFrame = (id: string): Frame => ({ id, isOpen: true })

/** True once the frame's Dismiss, close icon, Escape or outside press closed it. */
export const isFrameClosed = (frame: Frame, message: FrameMessage) => !KitModal.update(frame, message).model.isOpen

export interface FrameOptions {
	readonly size?: ModalSize
	readonly role?: "dialog" | "alertdialog"
	readonly isDismissable?: boolean
	readonly closeButton?: boolean
	readonly className?: string
}

export const frameView = <Message>(
	h: HtmlBuilder<Message>,
	frame: Frame,
	options: FrameOptions,
	toContent: (closeAttributes: ReadonlyArray<ChildAttribute>) => ReadonlyArray<Html>,
	toParentMessage: (message: FrameMessage) => Message,
): Html =>
	h.submodel({
		slotId: frame.id,
		model: frame,
		view: KitModal.view,
		viewInputs: { toTrigger: (_attributes, overlay) => overlay, toContent, ...options },
		toParentMessage,
	})

/** `ModalTitle` (DialogTitle, labelled by the frame's dialog). */
export const modalTitle = <Message>(h: HtmlBuilder<Message>, frame: Frame, text: string): Html =>
	dialogTitle(h, { id: KitModal.titleId(frame.id) }, text)

/** Field `Description` as legacy modal headers use it. */
export const modalDescription = <Message>(h: HtmlBuilder<Message>, text: string): Html =>
	description(h, {}, [text])
