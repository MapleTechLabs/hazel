import { Effect, Option, Queue, Schema, Stream } from "effect"
import { Mount, Submodel, type Update } from "foldkit"
import { type ChildAttribute, childAttributes, type Html, type HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { twMerge } from "tailwind-merge"
import { type ModalSize, modalContentBase, modalOverlayClassName } from "~/components/ui/modal.styles"
import {
	containFocus,
	dismissButton,
	observeDialogParts,
	portalOverlay,
	restoreFocusTo,
	restoreFocusToPrevious,
	trackViewportHeight,
	watchInteractOutside,
} from "./aria/overlay"
import { dialog, dialogCloseIcon } from "./dialog"

/** Port of `components/ui/modal.tsx` (React Aria DialogTrigger + ModalOverlay + Modal + Dialog). */

// MODEL

export const Model = Schema.Struct({ id: Schema.String, isOpen: Schema.Boolean })
export type Model = typeof Model.Type

export const init = (id: string): Model => ({ id, isOpen: false })

// MESSAGE

export const Message = defineMessageUnion({
	ClickedTrigger: {},
	ClickedClose: {},
	PressedEscape: {},
	PressedOutside: {},
	CompletedPortalModal: {},
})
export type Message = typeof Message.Type

export const triggerId = (id: string) => `${id}-trigger`
export const dialogId = (id: string) => `${id}-dialog`
export const titleId = (id: string) => `${id}-title`

// UPDATE

const closed = (model: Model): Model => modifyFields(model, { isOpen: () => false })

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
	Message.match<Update.Return<Model, Message>>(message, {
		ClickedTrigger: () => ({ model: modifyFields(model, { isOpen: () => true }) }),
		ClickedClose: () => ({ model: closed(model) }),
		PressedEscape: () => ({ model: closed(model) }),
		PressedOutside: () => ({ model: closed(model) }),
		CompletedPortalModal: () => ({ model }),
	})

/** Opens the modal from the parent (controlled `isOpen`). */
export const open = (model: Model): Update.Return<Model, Message> => ({
	model: modifyFields(model, { isOpen: () => true }),
})
/** Closes the modal from the parent. */
export const close = (model: Model): Update.Return<Model, Message> => ({ model: closed(model) })

// MOUNT

type PortalModalMessage = Extract<Message, { _tag: "CompletedPortalModal" | "PressedOutside" }>

/** The Overlay + ModalOverlay + FocusScope behavior shared by Modal and Sheet. */
export const PortalModal = Mount.defineStream("PortalModal", {
	/** `restoresToPrevious`: a controlled overlay with no trigger returns focus to what had it before. */
	args: { id: Schema.String, isDismissable: Schema.Boolean, restoresToPrevious: Schema.Boolean },
	messages: [Message.CompletedPortalModal, Message.PressedOutside],
	execute: ({ element, id, isDismissable, restoresToPrevious }) =>
		Stream.callback<PortalModalMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const restoreFocus = restoresToPrevious
						? restoreFocusToPrevious(element)
						: restoreFocusTo(triggerId(id), element)
					const releasePortal = portalOverlay(element, { isModal: true })
					const overlay = element.querySelector<HTMLElement>("[data-modal-overlay]")
					const releaseViewport = overlay ? trackViewportHeight(overlay) : () => undefined
					const releaseParts = observeDialogParts(element)
					document.getElementById(dialogId(id))?.focus({ preventScroll: true })
					const releaseFocus = containFocus(element)
					const releaseOutside = isDismissable
						? watchInteractOutside(`[data-modal-content="${CSS.escape(id)}"]`, () =>
								Queue.offerUnsafe(queue, Message.PressedOutside()),
							)
						: () => undefined
					Queue.offerUnsafe(queue, Message.CompletedPortalModal())
					return () => {
						releaseOutside()
						releaseFocus()
						releaseParts()
						releaseViewport()
						releasePortal()
						restoreFocus()
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

// VIEW

export type ViewInputs = Readonly<{
	/** Renders the trigger (DialogTrigger child). Spread `attributes` on it and put `overlay` last. */
	toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
	/** Dialog content; spread `closeAttributes` on ModalClose buttons. */
	toContent: (closeAttributes: ReadonlyArray<ChildAttribute>) => ReadonlyArray<Html>
	size?: ModalSize
	role?: "dialog" | "alertdialog"
	isDismissable?: boolean
	isBlurred?: boolean
	closeButton?: boolean
	className?: string
}>

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const triggerAttributes = childAttributes([
		...(model.isOpen ? [h.Attribute("aria-controls", dialogId(model.id))] : []),
		h.Attribute("aria-expanded", model.isOpen ? "true" : "false"),
		...(model.isOpen ? [h.Attribute("data-pressed", "true")] : []),
		h.Id(triggerId(model.id)),
		h.OnClick(Message.ClickedTrigger()),
	])
	return viewInputs.toTrigger(
		triggerAttributes,
		model.isOpen ? modalOverlay(model, viewInputs, h, (message) => message) : h.empty,
	)
})

/**
 * A controlled Modal (`<Modal isOpen>` with no DialogTrigger) rendered in the parent's view, so the
 * content can carry the parent's Messages; the Modal's own Messages go through `toParentMessage`.
 */
export const controlledModal = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	options: Omit<ViewInputs, "toTrigger"> & {
		readonly model: Model
		readonly toParentMessage: (message: Message) => ParentMessage
	},
): Html => (options.model.isOpen ? modalOverlay(options.model, options, h, options.toParentMessage) : h.empty)

const modalOverlay = <ParentMessage>(
	model: Model,
	viewInputs: Omit<ViewInputs, "toTrigger">,
	h: HtmlBuilder<ParentMessage>,
	send: (message: Message) => ParentMessage,
): Html => {
	const size = viewInputs.size ?? "lg"
	const role = viewInputs.role ?? "dialog"
	const isDismissable = viewInputs.isDismissable ?? role !== "alertdialog"
	const closeAttributes = childAttributes([h.OnClick(send(Message.ClickedClose()))])
	return h.div(
		[
			h.Attribute("style", "display: contents;"),
			h.OnMount(
				Mount.mapMessage(
					PortalModal({ id: model.id, isDismissable, restoresToPrevious: false }),
					send,
				),
			),
			h.OnKeyDownPreventDefault((key) =>
				key === "Escape" ? Option.some(send(Message.PressedEscape())) : Option.none(),
			),
		],
		[
			h.span([
				h.Attribute("data-focus-scope-start", "true"),
				h.Attribute("hidden", ""),
				h.Attribute("inert", ""),
			]),
			h.div(
				[
					h.Class(modalOverlayClassName(size, viewInputs.isBlurred ?? false)),
					h.Attribute("data-modal-overlay", ""),
					h.Attribute("data-rac", ""),
					h.Attribute("data-slot", "modal-overlay"),
				],
				[
					h.div(
						[
							h.Class(twMerge(twMerge(...modalContentBase(size)), viewInputs.className)),
							h.Attribute("data-modal-content", model.id),
							h.Attribute("data-rac", ""),
							h.Attribute("data-slot", "modal-content"),
						],
						[
							...(isDismissable ? [dismissButton(h, send(Message.ClickedClose()))] : []),
							dialog(h, { id: dialogId(model.id), role, labelledBy: titleId(model.id) }, [
								...viewInputs.toContent(closeAttributes),
								...((viewInputs.closeButton ?? true) && isDismissable
									? [dialogCloseIcon(h, closeAttributes)]
									: []),
							]),
						],
					),
				],
			),
			h.span([
				h.Attribute("data-focus-scope-end", "true"),
				h.Attribute("hidden", ""),
				h.Attribute("inert", ""),
			]),
		],
	)
}
