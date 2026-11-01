import { Popover } from "@foldkit/ui"
import { Submodel } from "foldkit"
import { type ChildAttribute, childAttributes, type Html, type HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	popoverArrowClassName,
	popoverBackdropClassName,
	popoverContentBase,
	popoverFooterBase,
	popoverInnerClassName,
} from "~/components/ui/popover.styles"
import { type Placement, toAnchorPlacement } from "./aria/placement"
import { dialogFooter } from "./dialog"

/**
 * A dialog popover on @foldkit/ui Popover: the trigger toggles it, Floating UI anchors the panel,
 * Escape and a press on the backdrop close it and focus returns to the trigger. Focus moves to the
 * content on open (`contentFocus`), so pressing a control inside it keeps the popover open.
 */

// MODEL

export const Model = Popover.Model
export type Model = Popover.Model

export const init = (id: string): Model => Popover.init({ id, contentFocus: true })

// MESSAGE

export const Message = Popover.Message
export type Message = Popover.Message

export const OutMessage = Popover.OutMessage
export type OutMessage = Popover.OutMessage

export const AnchorPopover = Popover.AnchorPopover
export const PortalPopoverBackdrop = Popover.PortalPopoverBackdrop
export const FocusButton = Popover.FocusButton

export const triggerId = Popover.buttonId
const contentId = (id: string) => `${id}-content`

// UPDATE

export const update = Popover.update

// VIEW

/** `PopoverFooter`: DialogFooter with buttons pushed to the end. */
export const popoverFooter = <M>(
	h: HtmlBuilder<M>,
	children: ReadonlyArray<Html | string>,
	className?: string,
): Html => dialogFooter(h, children, twMerge(popoverFooterBase, className))

export type ViewInputs = Readonly<{
	/** Renders the trigger button; spread `attributes` on it. The panel renders beside it. */
	toTrigger: (attributes: ReadonlyArray<ChildAttribute>) => Html
	/** Popover content; spread `closeAttributes` on PopoverClose buttons. */
	toContent: (closeAttributes: ReadonlyArray<ChildAttribute>) => ReadonlyArray<Html>
	placement?: Placement
	arrow?: boolean
	offset?: number
	className?: string
}>

const ARROW_OFFSET = 12
const OFFSET = 8
const VIEWPORT_PADDING = 12

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const arrow = viewInputs.arrow ?? false
	return h.submodel({
		slotId: model.id,
		model,
		view: Popover.view,
		viewInputs: {
			anchor: {
				placement: toAnchorPlacement(viewInputs.placement ?? "bottom"),
				gap: viewInputs.offset ?? (arrow ? ARROW_OFFSET : OFFSET),
				padding: VIEWPORT_PADDING,
			},
			focusSelector: `#${contentId(model.id)}`,
			toView: (render: Popover.RenderInfo) => {
				const closeAttributes = childAttributes([
					h.Type("button"),
					h.OnClick(Message.RequestedClose()),
				])
				return h.div(
					[h.Class("contents")],
					[
						viewInputs.toTrigger(render.button),
						...(render.isVisible
							? [
									h.div([...render.backdrop, h.Class(popoverBackdropClassName)]),
									h.div(
										[
											...render.panel,
											h.Class(
												twMerge(
													...popoverContentBase,
													"min-w-(--button-width)",
													viewInputs.className,
												),
											),
											h.Role("dialog"),
											h.AriaLabelledBy(triggerId(model.id)),
										],
										[
											...(arrow
												? [
														h.svg(
															[
																...render.arrow,
																h.Attribute("width", "12"),
																h.Attribute("height", "12"),
																h.Attribute("viewBox", "0 0 12 12"),
																h.Class(popoverArrowClassName),
															],
															[h.path([h.Attribute("d", "M0 0 L6 6 L12 0")])],
														),
													]
												: []),
											h.div(
												[
													h.Id(contentId(model.id)),
													h.Tabindex(-1),
													h.DataAttribute("slot", "popover-inner"),
													h.Class(popoverInnerClassName),
												],
												viewInputs.toContent(closeAttributes),
											),
										],
									),
								]
							: []),
					],
				)
			},
		},
		toParentMessage: (message) => message,
	})
})
