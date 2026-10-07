import { Effect, Option, Queue, Schema, Stream } from "effect"
import { Mount } from "foldkit"
import { type ChildAttribute, childAttributes, type Html, type HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { dismissButton, focusScopeSentinel, openModalPopover, popoverUnderlay } from "../ui/aria/overlay"

/**
 * React Aria `DialogTrigger` > unstyled `Popover` > `Dialog`, as the emoji and GIF pickers use it:
 * a modal popover (underlay, focus sentinels, dismiss buttons) around a labelled dialog.
 */

export const triggerId = (id: string) => `${id}-trigger`
export const popoverId = (id: string) => `${id}-popover`
export const dialogId = (id: string) => `${id}-dialog`

export const PopoverEvent = defineMessageUnion({
	CompletedPortalPickerPopover: {},
	PressedOutside: {},
	PressedEscape: {},
	ClickedDismiss: {},
	ClickedTrigger: {},
})
export type PopoverEvent = typeof PopoverEvent.Type

type PortalEvent = typeof PopoverEvent.CompletedPortalPickerPopover.Type | typeof PopoverEvent.PressedOutside.Type

/** Portals the popover, positions it under (or above) the trigger and watches outside presses. */
const PortalPickerPopover = Mount.defineStream("PortalPickerPopover", {
	args: { id: Schema.String },
	messages: [PopoverEvent.CompletedPortalPickerPopover, PopoverEvent.PressedOutside],
	execute: ({ element, id }) =>
		Stream.callback<PortalEvent>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const release = openModalPopover(element, {
						triggerId: triggerId(id),
						placement: "bottom",
						offset: 8,
						initialFocusId: dialogId(id),
						insideSelector: `#${CSS.escape(popoverId(id))}`,
						onInteractOutside: () => Queue.offerUnsafe(queue, PopoverEvent.PressedOutside()),
					})
					Queue.offerUnsafe(queue, PopoverEvent.CompletedPortalPickerPopover())
					return release
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

export interface PopoverInputs<M> {
	readonly id: string
	readonly isOpen: boolean
	readonly ariaLabel: string
	readonly toMessage: (event: PopoverEvent) => M
	/** The DialogTrigger's child: spread `attributes` on the button and put `overlay` last. */
	readonly toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
	readonly content: () => ReadonlyArray<Html>
}

const overlay = <M>(h: HtmlBuilder<M>, inputs: PopoverInputs<M>): Html => {
	const { id, toMessage } = inputs
	return h.div(
		[
			h.Attribute("style", "display: contents;"),
			h.OnMount(Mount.mapMessage(PortalPickerPopover({ id }), toMessage)),
		],
		[
			focusScopeSentinel(h, "start"),
			popoverUnderlay(h),
			h.div(
				[h.Attribute("style", "display: contents;")],
				[
					h.div(
						[
							h.Attribute("aria-labelledby", triggerId(id)),
							h.Class("react-aria-Popover"),
							h.Attribute("data-popover", ""),
							h.Attribute("data-rac", ""),
							h.Attribute("data-trigger", "DialogTrigger"),
							h.Attribute("dir", "ltr"),
							h.Id(popoverId(id)),
							h.OnKeyDownPreventDefault((key) =>
								key === "Escape" ? Option.some(toMessage(PopoverEvent.PressedEscape())) : Option.none(),
							),
						],
						[
							dismissButton(h, toMessage(PopoverEvent.ClickedDismiss())),
							h.section(
								[
									h.Attribute("aria-label", inputs.ariaLabel),
									h.Class("rounded-lg"),
									h.Attribute("data-rac", ""),
									h.Id(dialogId(id)),
									h.Role("dialog"),
									h.Attribute("tabindex", "-1"),
								],
								inputs.content(),
							),
							dismissButton(h, toMessage(PopoverEvent.ClickedDismiss())),
						],
					),
				],
			),
			focusScopeSentinel(h, "end"),
		],
	)
}

/** The trigger with React Aria's open-state attributes, and the popover while open. */
export const pickerPopover = <M>(h: HtmlBuilder<M>, inputs: PopoverInputs<M>): Html =>
	inputs.toTrigger(
		childAttributes([
			...(inputs.isOpen ? [h.Attribute("aria-controls", dialogId(inputs.id))] : []),
			h.Attribute("aria-expanded", inputs.isOpen ? "true" : "false"),
			...(inputs.isOpen ? [h.Attribute("data-pressed", "true")] : []),
			h.Id(triggerId(inputs.id)),
			h.OnClick(inputs.toMessage(PopoverEvent.ClickedTrigger())),
		]),
		inputs.isOpen ? overlay(h, inputs) : h.empty,
	)
