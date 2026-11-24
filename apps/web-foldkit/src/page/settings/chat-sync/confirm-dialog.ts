import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { button } from "../../../ui/button"
import {
	dialog,
	dialogClose,
	dialogDescription,
	dialogFooter,
	dialogHeader,
	dialogTitle,
} from "../../../ui/dialog"
import { iconTile } from "../../../ui/icon-tile"
import * as Modal from "../../../ui/modal"
import * as ConfirmAction from "../../shared/confirm-action"

/**
 * The chat sync pages' confirmations: `<Modal><ModalContent isOpen size="md"><Dialog>` with a danger
 * icon tile, a title, a description naming the target, Cancel and a pending danger button.
 */
export const confirmDialog = <Target, Message>(
	h: HtmlBuilder<Message>,
	options: Readonly<{
		slotId: string
		confirm: ConfirmAction.Model<Target>
		icon: Html
		title: string
		/** Description text before and after the highlighted name of the target. */
		description: (target: Target) => readonly [string, string, string]
		confirmLabel: string
		pendingLabel: string
		onConfirm: Message
		toParentMessage: (message: ConfirmAction.Message) => Message
	}>,
): Html => {
	const titleId = `${options.slotId}-title`
	const isPending = ConfirmAction.isRunning(options.confirm)
	const [before, name, after] = Option.match(ConfirmAction.targetOf(options.confirm), {
		onNone: () => ["", "", ""] as const,
		onSome: options.description,
	})
	return h.submodel({
		slotId: options.slotId,
		model: options.confirm.modal,
		view: Modal.view,
		viewInputs: {
			size: "md",
			toContent: (closeAttributes) => [
				dialog(h, { id: `${options.slotId}-inner`, role: "dialog", labelledBy: titleId }, [
					dialogHeader(h, {}, [
						iconTile(h, { intent: "danger" }, options.icon),
						dialogTitle(h, { id: titleId }, options.title),
						dialogDescription(h, [
							before,
							" ",
							h.span([h.Class("font-medium text-fg")], [name]),
							after,
						]),
					]),
					dialogFooter(h, [
						dialogClose(h, closeAttributes, ["Cancel"], "secondary"),
						button(
							h,
							{
								intent: "danger",
								isDisabled: isPending,
								isPending,
								onPress: options.onConfirm,
							},
							[isPending ? options.pendingLabel : options.confirmLabel],
						),
					]),
				]),
			],
		},
		toParentMessage: (message) => options.toParentMessage(ConfirmAction.toModalMessage(message)),
	})
}
