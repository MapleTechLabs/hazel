import { Dialog } from "@foldkit/ui"
import { Schema } from "effect"
import { Submodel, type Update } from "foldkit"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { modifyFields } from "foldkit/struct"
import { twMerge } from "tailwind-merge"
import {
	type ModalSize,
	modalBackdropClassName,
	modalContentBase,
	modalLayoutClassName,
} from "~/components/ui/modal.styles"
import { dialogCloseIcon, dialogSection } from "./dialog"

/**
 * A modal dialog on @foldkit/ui Dialog: a native `<dialog>` that isolates the page, locks scroll,
 * traps focus, closes on Escape and returns focus when it closes. The panel fades and scales in
 * through `@starting-style`, so modals that exist only while open (the app's modal host) animate too.
 * Sheet shares this Model, Message and update; only its panel differs.
 */

// MODEL

export const Model = Dialog.Model
export type Model = Dialog.Model

export type InitConfig = Readonly<{
	/** A selector for the element focused on open, in place of the first focusable one. */
	focusSelector?: string
}>

export const init = (id: string, config: InitConfig = {}): Model => Dialog.init({ id, ...config })

/**
 * The open Model of a modal whose parent keeps no Model (a modal open for as long as it renders, or
 * one derived from a parent's flag). Its Mount takes the dialog resources; removal releases them.
 */
export const initOpen = (id: string): Model => ({ ...init(id), isOpen: true })

// MESSAGE

export const Message = Dialog.Message
export type Message = Dialog.Message

export const OutMessage = Dialog.OutMessage
export type OutMessage = Dialog.OutMessage

/** The Mount on the `<dialog>` that acquires its resources once it renders open. */
export const AcquireResources = Dialog.AcquireResources

export const titleId = (id: string): string => Dialog.titleId(init(id))
export const dialogId = (id: string): string => `${id}-content`

/** The modal asked to close: its close button, close icon, Escape or a press on the backdrop. */
export const isCloseRequest = (message: Message): boolean => Schema.is(Message.RequestedClose)(message)

/** The dialog rendered open and moved focus in: the moment for a field's autofocus. */
export const isReady = (message: Message): boolean => Schema.is(Message.SucceededAcquireResources)(message)

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

/**
 * Opens the modal from the parent; fold it with `Update.foldChildStep`. A Model change: the dialog
 * renders only while open, and its Mount shows it and takes its resources.
 */
export const open = (model: Model): UpdateReturn =>
	model.isOpen
		? { model }
		: { model: modifyFields(model, { isOpen: () => true }), outMessage: OutMessage.Opened() }

/** Closes the modal from the parent; removing the dialog releases its resources and returns focus. */
export const close = (model: Model): UpdateReturn =>
	model.isOpen
		? { model: modifyFields(model, { isOpen: () => false }), outMessage: OutMessage.Closed() }
		: { model }

/** Open and close requests are Model changes (see `open`); the rest is the Dialog's own lifecycle. */
export const update = (model: Model, message: Message): UpdateReturn =>
	Schema.is(Message.RequestedOpen)(message)
		? open(model)
		: Schema.is(Message.RequestedClose)(message)
			? close(model)
			: Dialog.update(model, message)

/** A `foldOutMessage` for a parent that reads `isOpen` rather than reacting to Opened or Closed. */
export const ignoreOutMessage =
	(_outMessage: OutMessage) =>
	<ParentModel>(model: ParentModel) => ({ model })

// VIEW

export type Role = "dialog" | "alertdialog"

/** What Modal and Sheet share: the role, dismissal and the content. */
export type DialogInputs = Readonly<{
	/** Dialog content; spread `closeAttributes` on ModalClose buttons. */
	toContent: (closeAttributes: ReadonlyArray<ChildAttribute>) => ReadonlyArray<Html>
	role?: Role
	/** Defaults to true for a dialog and false for an alertdialog. */
	isDismissable?: boolean
	isBlurred?: boolean
	closeButton?: boolean
	className?: string
	/** `aria-label` on the dialog; without it the dialog is labelled by its title (`titleId`). */
	ariaLabel?: string
}>

export type ViewInputs = DialogInputs & Readonly<{ size?: ModalSize }>

type Parts = Readonly<{
	backdropClassName: string
	layoutClassName: string | null
	panelClassName: string
	closeIconClassName?: string
	panelAttributes?: ReadonlyArray<ChildAttribute>
}>

/** The `<dialog>` Modal and Sheet render: a backdrop, then the panel above it (not inside it). */
export const dialogView = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	inputs: DialogInputs,
	parts: Parts,
	toParentMessage: (message: Message) => M,
): Html =>
	h.submodel({
		slotId: model.id,
		model,
		view: Dialog.view,
		viewInputs: {
			toView: (render: Dialog.RenderInfo) => {
				const role = inputs.role ?? "dialog"
				const isDismissable = inputs.isDismissable ?? role !== "alertdialog"
				const panel = h.div(
					[
						...render.panel,
						h.Class(twMerge(parts.panelClassName, inputs.className)),
						h.DataAttribute("slot", "modal-content"),
						...(parts.panelAttributes ?? []),
					],
					[
						dialogSection(h, { id: dialogId(model.id) }, [
							...inputs.toContent(render.closeButton),
							...((inputs.closeButton ?? true) && isDismissable
								? [dialogCloseIcon(h, render.closeButton, parts.closeIconClassName)]
								: []),
						]),
					],
				)
				// Rendered only while visible, so every open inserts a fresh `<dialog>` whose Mount takes
				// the dialog resources, and every close removes it and releases them, whether or not the
				// parent keeps the Model.
				if (!render.isVisible) return h.empty
				return h.dialog(
					[
						...render.dialog,
						...(role === "alertdialog" ? [h.Role("alertdialog")] : []),
						...(inputs.ariaLabel === undefined ? [] : [h.AriaLabel(inputs.ariaLabel)]),
						h.Class("m-0 overflow-visible bg-transparent p-0"),
					],
					[
						h.div([
							...(isDismissable ? render.backdrop : []),
							h.Class(
								twMerge(
									parts.backdropClassName,
									(inputs.isBlurred ?? false) && "backdrop-blur-[1px]",
								),
							),
							h.DataAttribute("slot", "modal-overlay"),
						]),
						parts.layoutClassName === null
							? panel
							: h.div([h.Class(parts.layoutClassName)], [panel]),
					],
				)
			},
		},
		toParentMessage,
	})

const modalParts = (size: ModalSize): Parts => ({
	backdropClassName: modalBackdropClassName,
	layoutClassName: modalLayoutClassName(size),
	panelClassName: twMerge(...modalContentBase(size)),
})

/** The modal as a Submodel view: `h.submodel({ model, view: Modal.view, viewInputs, toParentMessage })`. */
export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) =>
	dialogView(h, model, viewInputs, modalParts(viewInputs.size ?? "lg"), (message) => message),
)

/** The modal rendered straight from the parent's view, its Messages wrapped by `toParentMessage`. */
export const controlledModal = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	options: ViewInputs &
		Readonly<{
			model: Model
			toParentMessage: (message: Message) => ParentMessage
		}>,
): Html => dialogView(h, options.model, options, modalParts(options.size ?? "lg"), options.toParentMessage)
