import { Option } from "effect"
import { Submodel } from "foldkit"
import { type ChildAttribute, childAttributes, type Html, type HtmlBuilder } from "foldkit/html"
import {
	type Sides,
	sheetCloseIconClassName,
	sheetContentStyles,
	sheetOverlayClassName,
} from "~/components/ui/sheet.styles"
import { dismissButton } from "./aria/overlay"
import { dialog, dialogCloseIcon } from "./dialog"
import { dialogId, Message, type Model, PortalModal, titleId, triggerId } from "./modal"

/**
 * Port of `components/ui/sheet.tsx`. A sheet is a Modal with edge-anchored panel classes, so it
 * shares the Modal Model, Message and update (`Modal.init`, `Modal.update`); only the view differs.
 */

export type ViewInputs = Readonly<{
	/** Renders the trigger (DialogTrigger child). Spread `attributes` on it and put `overlay` last. */
	toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
	/** Sheet content; spread `closeAttributes` on SheetClose buttons. */
	toContent: (closeAttributes: ReadonlyArray<ChildAttribute>) => ReadonlyArray<Html>
	side?: Sides
	isFloat?: boolean
	role?: "dialog" | "alertdialog"
	isDismissable?: boolean
	isBlurred?: boolean
	closeButton?: boolean
	className?: string
	/** `aria-label` on the dialog; without it the dialog is labelled by its title. */
	ariaLabel?: string
	/** Extra attributes ModalOverlay spreads on the overlay (`data-slot`, `data-intent`). */
	overlayAttributes?: Readonly<Record<string, string>>
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
		model.isOpen ? sheetOverlay(model, viewInputs, h) : h.empty,
	)
})

const sheetOverlay = (model: Model, viewInputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
	const role = viewInputs.role ?? "dialog"
	const isDismissable = viewInputs.isDismissable ?? role !== "alertdialog"
	const closeAttributes = childAttributes([h.OnClick(Message.ClickedClose())])
	return h.div(
		[
			h.Attribute("style", "display: contents;"),
			h.OnMount(PortalModal({ id: model.id, isDismissable })),
			h.OnKeyDownPreventDefault((key) =>
				key === "Escape" ? Option.some(Message.PressedEscape()) : Option.none(),
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
					h.Class(sheetOverlayClassName(false, false, viewInputs.isBlurred ?? false)),
					h.Attribute("data-modal-overlay", ""),
					h.Attribute("data-rac", ""),
					...Object.entries(viewInputs.overlayAttributes ?? {}).map(([name, value]) =>
						h.Attribute(name, value),
					),
				],
				[
					h.div(
						[
							h.Class(
								sheetContentStyles({
									isEntering: false,
									isExiting: false,
									side: viewInputs.side ?? "right",
									isFloat: viewInputs.isFloat ?? true,
									className: viewInputs.className,
								}),
							),
							h.Attribute("data-modal-content", model.id),
							h.Attribute("data-rac", ""),
						],
						[
							...(isDismissable ? [dismissButton(h, Message.ClickedClose())] : []),
							dialog(
								h,
								viewInputs.ariaLabel
									? { id: dialogId(model.id), role, ariaLabel: viewInputs.ariaLabel }
									: { id: dialogId(model.id), role, labelledBy: titleId(model.id) },
								[
									...viewInputs.toContent(closeAttributes),
									...((viewInputs.closeButton ?? true) && isDismissable
										? [dialogCloseIcon(h, closeAttributes, sheetCloseIconClassName)]
										: []),
								],
							),
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
