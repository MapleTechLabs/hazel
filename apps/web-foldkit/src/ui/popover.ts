import { Effect, Option, Queue, Schema, Stream } from "effect"
import { Mount, Submodel, type Update } from "foldkit"
import { type ChildAttribute, childAttributes, type Html, type HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { twMerge } from "tailwind-merge"
import {
	popoverArrowClassName,
	popoverContentBase,
	popoverFooterBase,
	popoverInnerClassName,
} from "~/components/ui/popover.styles"
import { dismissButton, observeDialogParts, openModalPopover } from "./aria/overlay"
import type { Placement } from "./aria/position"
import { dialogFooter } from "./dialog"

/** Port of `components/ui/popover.tsx` (React Aria DialogTrigger + Popover). */

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
	CompletedPortalPopover: {},
})
export type Message = typeof Message.Type

export const triggerId = (id: string) => `${id}-trigger`
export const popoverId = (id: string) => `${id}-popover`

// UPDATE

const closed = (model: Model): Model => modifyFields(model, { isOpen: () => false })

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
	Message.match<Update.Return<Model, Message>>(message, {
		ClickedTrigger: () => ({ model: modifyFields(model, { isOpen: () => !model.isOpen }) }),
		ClickedClose: () => ({ model: closed(model) }),
		PressedEscape: () => ({ model: closed(model) }),
		PressedOutside: () => ({ model: closed(model) }),
		CompletedPortalPopover: () => ({ model }),
	})

// MOUNT

type PortalPopoverMessage = Extract<Message, { _tag: "CompletedPortalPopover" | "PressedOutside" }>

const PortalPopover = Mount.defineStream("PortalPopover", {
	args: { id: Schema.String, placement: Schema.String, offset: Schema.Number },
	messages: [Message.CompletedPortalPopover, Message.PressedOutside],
	execute: ({ element, id, placement, offset }) =>
		Stream.callback<PortalPopoverMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const release = openModalPopover(element, {
						triggerId: triggerId(id),
						placement: placement as Placement,
						offset,
						arrowSelector: ":scope > .group",
						isTriggerWidthSet: true,
						initialFocusId: popoverId(id),
						insideSelector: `#${CSS.escape(popoverId(id))}`,
						onInteractOutside: () => Queue.offerUnsafe(queue, Message.PressedOutside()),
					})
					const releaseParts = observeDialogParts(element)
					Queue.offerUnsafe(queue, Message.CompletedPortalPopover())
					return () => {
						releaseParts()
						release()
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

// VIEW

/** `PopoverFooter`: DialogFooter with buttons pushed to the end. */
export const popoverFooter = <M>(
	h: HtmlBuilder<M>,
	children: ReadonlyArray<Html | string>,
	className?: string,
): Html => dialogFooter(h, children, twMerge(popoverFooterBase, className))

export type ViewInputs = Readonly<{
	/** Renders the trigger (DialogTrigger child). Spread `attributes` on it and put `overlay` last. */
	toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
	/** Popover content; spread `closeAttributes` on PopoverClose buttons. */
	toContent: (closeAttributes: ReadonlyArray<ChildAttribute>) => ReadonlyArray<Html>
	placement?: Placement
	arrow?: boolean
	offset?: number
	className?: string
}>

const ARROW_OFFSET = 12
const OFFSET = 8

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const triggerAttributes = childAttributes([
		...(model.isOpen ? [h.Attribute("aria-controls", popoverId(model.id))] : []),
		h.Attribute("aria-expanded", model.isOpen ? "true" : "false"),
		...(model.isOpen ? [h.Attribute("data-pressed", "true")] : []),
		h.Id(triggerId(model.id)),
		h.OnClick(Message.ClickedTrigger()),
	])
	return viewInputs.toTrigger(
		triggerAttributes,
		model.isOpen ? popoverOverlay(model, viewInputs, h) : h.empty,
	)
})

const popoverOverlay = (model: Model, viewInputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
	const arrow = viewInputs.arrow ?? false
	const closeAttributes = childAttributes([h.OnClick(Message.ClickedClose())])
	return h.div(
		[
			h.Attribute("style", "display: contents;"),
			h.OnMount(
				PortalPopover({
					id: model.id,
					placement: viewInputs.placement ?? "bottom",
					offset: viewInputs.offset ?? (arrow ? ARROW_OFFSET : OFFSET),
				}),
			),
		],
		[
			h.span([
				h.Attribute("data-focus-scope-start", "true"),
				h.Attribute("hidden", ""),
				h.Attribute("inert", ""),
			]),
			h.div([
				h.Attribute("inert", ""),
				h.Attribute("data-testid", "underlay"),
				h.Attribute("style", "position: fixed; inset: 0px;"),
			]),
			h.div(
				[h.Attribute("style", "display: contents;")],
				[
					h.div(
						[
							h.Attribute("aria-labelledby", triggerId(model.id)),
							h.Class(twMerge(twMerge(...popoverContentBase), viewInputs.className)),
							h.Attribute("data-popover", ""),
							h.Attribute("data-rac", ""),
							h.Attribute("data-trigger", "DialogTrigger"),
							h.Attribute("dir", "ltr"),
							h.Id(popoverId(model.id)),
							h.Role("dialog"),
							h.Attribute("tabindex", "-1"),
							h.OnKeyDownPreventDefault((key) =>
								key === "Escape" ? Option.some(Message.PressedEscape()) : Option.none(),
							),
						],
						[
							dismissButton(h, Message.ClickedClose()),
							...(arrow
								? [
										h.div(
											[h.Class("group"), h.Attribute("data-rac", "")],
											[
												h.svg(
													[
														h.Attribute("width", "12"),
														h.Attribute("height", "12"),
														h.Attribute("viewBox", "0 0 12 12"),
														h.Class(popoverArrowClassName),
													],
													[h.path([h.Attribute("d", "M0 0 L6 6 L12 0")])],
												),
											],
										),
									]
								: []),
							h.div(
								[h.Attribute("data-slot", "popover-inner"), h.Class(popoverInnerClassName)],
								viewInputs.toContent(closeAttributes),
							),
							dismissButton(h, Message.ClickedClose()),
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
