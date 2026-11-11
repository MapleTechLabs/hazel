import { Schema } from "effect"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import type { ModalSize } from "~/components/ui/modal.styles"
import { dialogTitle } from "../../ui/dialog"
import { description } from "../../ui/field"
import * as KitModal from "../../ui/modal"

/**
 * Legacy controlled `<Modal isOpen onOpenChange><ModalContent>`: the kit Modal without a trigger.
 * A modal is open for as long as its slot exists, so its `frame` is only the dialog's id; the modal
 * closes itself when the frame asks to (`isCloseRequest`).
 */

export const Frame = Schema.Struct({ id: Schema.String })
export type Frame = typeof Frame.Type
/** The frame's Message; modals import it `as FrameMessage` so their Got wrapper names the child Message. */
export const Message = KitModal.Message
export type Message = KitModal.Message
type FrameMessage = KitModal.Message

export const initFrame = (id: string): Frame => ({ id })

/** The frame's close icon, a close button, Escape or a press on the backdrop. */
export const isCloseRequest = KitModal.isCloseRequest

/** The frame's dialog rendered and moved focus in: the moment for a field's `autoFocus`. */
export const isPortalReady = KitModal.isReady

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
		model: KitModal.initOpen(frame.id),
		view: KitModal.view,
		viewInputs: { toContent, ...options },
		toParentMessage,
	})

/** `ModalTitle` (DialogTitle, labelled by the frame's dialog). */
export const modalTitle = <Message>(h: HtmlBuilder<Message>, frame: Frame, text: string): Html =>
	dialogTitle(h, { id: KitModal.titleId(frame.id) }, text)

/** Field `Description` as legacy modal headers use it. */
export const modalDescription = <Message>(h: HtmlBuilder<Message>, text: string): Html =>
	description(h, {}, [text])
