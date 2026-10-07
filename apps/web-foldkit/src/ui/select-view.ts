import { Array, Effect, Option, Queue, Schema, Stream } from "effect"
import { Mount, Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	dropdownCheckIndicatorClassName,
	dropdownItemStyles,
	dropdownLabelBase,
} from "~/components/ui/dropdown.styles"
import { fieldStyles, labelStyles } from "~/components/ui/field.styles"
import { popoverContentBase, popoverInnerClassName } from "~/components/ui/popover.styles"
import {
	selectChevronClassName,
	selectListBoxBase,
	selectPopoverBase,
	selectTriggerBase,
	selectTriggerWrapperClassName,
	selectValueClassName,
} from "~/components/ui/select.styles"
import { IconCheck, IconChevronUpDown } from "../icons"
import { dismissButton, focusScopeSentinel, openModalPopover } from "./aria/overlay"
import {
	type Item,
	labelId,
	listboxId,
	Message,
	type Model,
	optionId,
	optionLabelId,
	triggerId,
	valueId,
} from "./select"

const SELECT_OFFSET = 8

// MOUNT

type PortalSelectMessage = Extract<Message, { _tag: "CompletedPortalSelect" | "PressedOutside" }>

const PortalSelect = Mount.defineStream("PortalSelect", {
	args: { id: Schema.String, initialFocusId: Schema.String },
	messages: [Message.CompletedPortalSelect, Message.PressedOutside],
	execute: ({ element, id, initialFocusId }) =>
		Stream.callback<PortalSelectMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const release = openModalPopover(element, {
						triggerId: triggerId(id),
						placement: "bottom",
						offset: SELECT_OFFSET,
						isTriggerWidthSet: true,
						initialFocusId,
						insideSelector: `[data-select-popover="${CSS.escape(id)}"]`,
						onInteractOutside: () => Queue.offerUnsafe(queue, Message.PressedOutside()),
					})
					Queue.offerUnsafe(queue, Message.CompletedPortalSelect())
					return release
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

// VIEW

export type ViewInputs = Readonly<{
	/** The `Label` inside the Select; omit it when the label sits outside (legacy create-channel). */
	label?: string
	placeholder?: string
	/** Select `className`. */
	className?: string
	/** Select `aria-label` without a visible Label (the label span is omitted). */
	ariaLabel?: string
	/** SelectTrigger `className`. */
	triggerClassName?: string
	/** SelectTrigger children, replacing the SelectValue and chevron. */
	renderTrigger?: <M>(h: HtmlBuilder<M>, selected: Option.Option<Item>) => Array<Html>
	/** SelectItem children that are not a plain string label. */
	renderOption?: <M>(h: HtmlBuilder<M>, item: Item) => Array<Html>
}>

type Open = Extract<Model["popup"], { _tag: "Open" }>

const optionLabel = <M>(h: HtmlBuilder<M>, label: string, id?: string): Html =>
	h.span(
		[h.Class(twMerge(dropdownLabelBase)), ...(id ? [h.Id(id)] : []), h.Attribute("slot", "label")],
		[label],
	)

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const isOpen = model.popup._tag === "Open"
	const selectedItem = Option.flatMap(model.selectedKey, (key) =>
		Array.findFirst(model.items, (candidate) => candidate.key === key),
	)
	const flag = (name: string, isOn: boolean) => (isOn ? [h.Attribute(name, "true")] : [])

	return h.div(
		[
			h.Class(twMerge(twMerge(fieldStyles({ className: "group/select" })), viewInputs.className)),
			...flag("data-disabled", model.isDisabled),
			...flag("data-focused", isOpen || model.isTriggerFocused),
			...flag("data-open", isOpen),
			h.Attribute("data-rac", ""),
			h.Attribute("data-slot", "control"),
		],
		[
			viewInputs.ariaLabel !== undefined || viewInputs.label === undefined
				? h.empty
				: h.span(
						[h.Class(labelStyles()), h.Attribute("data-slot", "label"), h.Id(labelId(model.id))],
						[viewInputs.label],
					),
			h.span(
				[h.Attribute("data-slot", "control"), h.Class(selectTriggerWrapperClassName)],
				[
					h.button(
						[
							...(isOpen ? [h.Attribute("aria-controls", listboxId(model.id))] : []),
							h.Attribute("aria-expanded", isOpen ? "true" : "false"),
							h.Attribute("aria-haspopup", "listbox"),
							...(viewInputs.ariaLabel !== undefined
								? [
										h.Attribute("aria-label", viewInputs.ariaLabel),
										h.Attribute("aria-labelledby", `${valueId(model.id)} ${triggerId(model.id)}`),
									]
								: viewInputs.label === undefined
									? [h.Attribute("aria-labelledby", valueId(model.id))]
									: [h.Attribute("aria-labelledby", `${valueId(model.id)} ${labelId(model.id)}`)]),
							h.Class(twMerge(twMerge(...selectTriggerBase), viewInputs.triggerClassName)),
							...flag("data-disabled", model.isDisabled),
							...flag("data-pressed", isOpen),
							h.Attribute("data-react-aria-pressable", "true"),
							...(model.isDisabled ? [h.Attribute("disabled", "")] : []),
							h.Id(triggerId(model.id)),
							...(model.isDisabled ? [] : [h.Attribute("tabindex", "0")]),
							h.Attribute("type", "button"),
							h.OnFocus(Message.FocusedTrigger()),
							h.OnBlur(Message.BlurredTrigger()),
							h.OnPointerDown((pointerType, button) =>
								button === 0
									? Option.some(Message.PressedTrigger({ pointerType }))
									: Option.none(),
							),
							h.OnKeyDownPreventDefault((key) =>
								Array.contains(
									["Enter", " ", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"],
									key,
								)
									? Option.some(Message.PressedTriggerKey({ key }))
									: Option.none(),
							),
						],
						[
							...(viewInputs.renderTrigger ? viewInputs.renderTrigger(h, selectedItem) : [
							Option.match(selectedItem, {
								onNone: () =>
									h.span(
										[
											h.Class(selectValueClassName),
											h.Attribute("data-placeholder", "true"),
											h.Attribute("data-rac", ""),
											h.Attribute("data-slot", "select-value"),
											h.Id(valueId(model.id)),
										],
										[viewInputs.placeholder ?? "Select an item"],
									),
								onSome: (found) =>
									h.span(
										[
											h.Class(selectValueClassName),
											h.Attribute("data-rac", ""),
											h.Attribute("data-slot", "select-value"),
											h.Id(valueId(model.id)),
										],
										[optionLabel(h, found.label)],
									),
							}),
							IconChevronUpDown(h, {
								className: selectChevronClassName,
								attributes: { "data-slot": "chevron" },
							}),
							]),
							model.popup._tag === "Open"
								? selectPopover(model, model.popup, h, viewInputs.renderOption)
								: h.empty,
						],
					),
				],
			),
			hiddenSelect(model, h),
		],
	)
})

/** HiddenSelect: the native select React Aria keeps for autofill and forms. */
const hiddenSelect = (model: Model, h: HtmlBuilder<Message>): Html =>
	h.div(
		[
			h.Attribute("aria-hidden", "true"),
			h.Attribute("data-a11y-ignore", "aria-hidden-focus"),
			h.Attribute("data-react-aria-prevent-focus", "true"),
			h.Attribute("data-testid", "hidden-select-container"),
			h.Attribute(
				"style",
				"border: 0px; clip: rect(0px, 0px, 0px, 0px); clip-path: inset(50%); height: 1px; margin: -1px; overflow: hidden; padding: 0px; position: fixed; width: 1px; white-space: nowrap; top: 0px; left: 0px;",
			),
		],
		[
			h.label(
				[],
				[
					h.select(
						[
							...(model.isDisabled ? [h.Attribute("disabled", "")] : []),
							h.Attribute("tabindex", "-1"),
							...(model.isDisabled ? [] : [h.Attribute("title", "")]),
						],
						[
							h.option([], []),
							...Array.map(model.items, (candidate) =>
								h.option([h.Attribute("value", candidate.key)], [candidate.label]),
							),
						],
					),
				],
			),
		],
	)

type RenderOption = ViewInputs["renderOption"]

const selectPopover = (model: Model, open: Open, h: HtmlBuilder<Message>, renderOption: RenderOption): Html => {
	const initialFocusId = Option.match(open.focusedKey, {
		onNone: () => listboxId(model.id),
		onSome: (key) => optionId(model.id, key),
	})
	return h.div(
		[
			h.Attribute("style", "display: contents;"),
			h.OnMount(PortalSelect({ id: model.id, initialFocusId })),
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
							h.Attribute("aria-labelledby", labelId(model.id)),
							h.Class(
								twMerge(
									twMerge(...popoverContentBase),
									twMerge(twMerge(selectPopoverBase), undefined),
								),
							),
							h.Attribute("data-popover", ""),
							h.Attribute("data-rac", ""),
							h.Attribute("data-select-popover", model.id),
							h.Attribute("data-trigger", "Select"),
							h.Attribute("dir", "ltr"),
							h.Role("dialog"),
							h.Attribute("tabindex", "-1"),
							h.OnKeyDownPreventDefault((key, modifiers) =>
								key === "Tab"
									? Option.none()
									: Option.some(
											Message.PressedListKey({
												key,
												isModified:
													modifiers.ctrlKey ||
													modifiers.metaKey ||
													modifiers.altKey,
											}),
										),
							),
						],
						[
							dismissButton(h, Message.ClickedDismiss()),
							h.div(
								[h.Class(popoverInnerClassName), h.Attribute("data-slot", "popover-inner")],
								[
									focusScopeSentinel(h, "start"),
									listbox(model, open, h, renderOption),
									focusScopeSentinel(h, "end"),
								],
							),
							dismissButton(h, Message.ClickedDismiss()),
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

const listbox = (model: Model, open: Open, h: HtmlBuilder<Message>, renderOption: RenderOption): Html =>
	h.div(
		[
			h.Attribute("aria-labelledby", labelId(model.id)),
			h.Class(twMerge(twMerge(selectListBoxBase), undefined)),
			h.Attribute("data-layout", "stack"),
			h.Attribute("data-orientation", "vertical"),
			h.Attribute("data-rac", ""),
			h.Id(listboxId(model.id)),
			h.Role("listbox"),
			h.Attribute("tabindex", Option.isSome(open.focusedKey) ? "-1" : "0"),
		],
		Array.map(model.items, (candidate) => option(model, open, candidate, h, renderOption)),
	)

const option = (
	model: Model,
	open: Open,
	candidate: Item,
	h: HtmlBuilder<Message>,
	renderOption: RenderOption,
): Html => {
	const { key } = candidate
	const isSelected = Option.contains(model.selectedKey, key)
	const isFocused = Option.contains(open.focusedKey, key)
	const isHovered = !candidate.isDisabled && Option.contains(open.hoveredKey, key)
	const flag = (name: string, isOn: boolean) => (isOn ? [h.Attribute(name, "true")] : [])
	return h.keyed("div")(
		key,
		[
			...(candidate.isDisabled ? [h.Attribute("aria-disabled", "true")] : []),
			h.Attribute("aria-labelledby", optionLabelId(model.id, key)),
			h.Attribute("aria-selected", isSelected ? "true" : "false"),
			h.Class(
				dropdownItemStyles({ isSelected, isFocused, isHovered, isDisabled: candidate.isDisabled }),
			),
			...flag("data-disabled", candidate.isDisabled),
			...flag("data-focus-visible", isFocused && open.modality === "Keyboard"),
			...flag("data-focused", isFocused),
			...flag("data-hovered", isHovered),
			h.Attribute("data-key", key),
			h.Attribute("data-rac", ""),
			h.Attribute("data-react-aria-pressable", "true"),
			...flag("data-selected", isSelected),
			h.Attribute("data-selection-mode", "single"),
			h.Id(optionId(model.id, key)),
			h.Role("option"),
			...(candidate.isDisabled ? [] : [h.Attribute("tabindex", isFocused ? "0" : "-1")]),
			h.OnMouseEnter(Message.HoveredOption({ key })),
			h.OnMouseLeave(Message.UnhoveredOption({ key })),
			h.OnClick(Message.ClickedOption({ key })),
		],
		[
			...(isSelected
				? [
						IconCheck(h, {
							className: dropdownCheckIndicatorClassName,
							attributes: { "data-slot": "check-indicator" },
						}),
					]
				: []),
			...(renderOption
				? renderOption(h, candidate)
				: [optionLabel(h, candidate.label, optionLabelId(model.id, key))]),
		],
	)
}
