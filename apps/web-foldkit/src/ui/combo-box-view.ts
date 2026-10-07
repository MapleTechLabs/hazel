import { Array, Effect, Option, Queue, Schema, Stream } from "effect"
import { Mount, Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	comboBoxButtonClassName,
	comboBoxChevronClassName,
	comboBoxInputWrapperClassName,
	comboBoxListBoxBase,
	comboBoxPopoverBase,
} from "~/components/ui/combo-box.styles"
import {
	dropdownCheckIndicatorClassName,
	dropdownItemStyles,
	dropdownLabelBase,
} from "~/components/ui/dropdown.styles"
import { fieldStyles, labelStyles } from "~/components/ui/field.styles"
import { inputStyles, inputControlStyles } from "~/components/ui/input.styles"
import { popoverContentBase, popoverInnerClassName } from "~/components/ui/popover.styles"
import { IconCheck, IconChevronUpDown } from "../icons"
import {
	ariaHideOutside,
	dismissButton,
	focusScopeSentinel,
	portalOverlay,
	positionOverlay,
} from "./aria/overlay"
import {
	buttonId,
	inputId,
	type Item,
	labelId,
	listboxId,
	Message,
	type Model,
	optionId,
	optionLabelId,
	visibleItems,
} from "./combo-box"

const OFFSET = 8

// MOUNT

type PortalComboBoxMessage = Extract<Message, { _tag: "CompletedPortalComboBox" }>

/** The non-modal list popover: portal, position under the input, keep focus in the input. */
const PortalComboBox = Mount.defineStream("PortalComboBox", {
	args: { id: Schema.String },
	messages: [Message.CompletedPortalComboBox],
	execute: ({ element, id }) =>
		Stream.callback<PortalComboBoxMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const releasePortal = portalOverlay(element, { isModal: false })
					const popover = element.querySelector<HTMLElement>("[data-popover]")
					const input = document.getElementById(inputId(id))
					const releasePosition = popover
						? positionOverlay(popover, {
								triggerId: inputId(id),
								placement: "bottom",
								offset: OFFSET,
								isTriggerWidthSet: true,
							})
						: () => undefined
					const releaseHidden =
						popover && input ? ariaHideOutside([input, popover]) : () => undefined
					const keepInputFocus = (event: Event) => event.preventDefault()
					element.addEventListener("mousedown", keepInputFocus)
					Queue.offerUnsafe(queue, Message.CompletedPortalComboBox())
					return () => {
						element.removeEventListener("mousedown", keepInputFocus)
						releaseHidden()
						releasePosition()
						releasePortal()
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

/** usePress `preventFocusOnPress` on the button, so pressing it never blurs the input. */
const KeepInputFocus = Mount.define("KeepComboBoxInputFocus", {
	messages: [Message.CompletedPortalComboBox],
	execute: ({ element }) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const onMouseDown = (event: Event) => event.preventDefault()
				element.addEventListener("mousedown", onMouseDown)
				return () => element.removeEventListener("mousedown", onMouseDown)
			}),
			(release) => Effect.sync(release),
		).pipe(Effect.as(Message.CompletedPortalComboBox())),
})

// VIEW

export type ViewInputs = Readonly<{
	/** The `Label` inside the ComboBox; TimezoneSelect has none. */
	label?: string
	placeholder?: string
	/** ComboBox `className`. */
	className?: string
	/** ComboBoxContent `className` (the ListBox). */
	listBoxClassName?: string
}>

type Open = Extract<Model["popup"], { _tag: "Open" }>

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const open = model.popup._tag === "Open" ? Option.some(model.popup) : Option.none<Open>()
	const isOpen = Option.isSome(open)
	const focusedKey = Option.flatMap(open, (popup) => popup.focusedKey)
	const flag = (name: string, isOn: boolean) => (isOn ? [h.Attribute(name, "true")] : [])

	return h.div(
		[
			h.Class(twMerge(twMerge(fieldStyles()), viewInputs.className)),
			...flag("data-focused", model.isFocused),
			...flag("data-open", isOpen),
			h.Attribute("data-rac", ""),
			h.Attribute("data-slot", "control"),
		],
		[
			...(viewInputs.label === undefined
				? []
				: [
						h.label(
							[
								h.Class(labelStyles()),
								h.Attribute("data-slot", "label"),
								h.Attribute("for", inputId(model.id)),
								h.Id(labelId(model.id)),
							],
							[viewInputs.label],
						),
					]),
			h.span(
				[h.Attribute("data-slot", "control"), h.Class(comboBoxInputWrapperClassName)],
				[
					h.span(
						[h.Attribute("data-slot", "control"), h.Class(inputControlStyles)],
						[
							h.input([
								...Option.match(focusedKey, {
									onNone: () => [],
									onSome: (key) => [
										h.Attribute("aria-activedescendant", optionId(model.id, key)),
									],
								}),
								h.Attribute("aria-autocomplete", "list"),
								...(isOpen ? [h.Attribute("aria-controls", listboxId(model.id))] : []),
								h.Attribute("aria-expanded", isOpen ? "true" : "false"),
								...(viewInputs.label === undefined
									? []
									: [h.Attribute("aria-labelledby", labelId(model.id))]),
								h.Attribute("autocomplete", "off"),
								h.Attribute("autocorrect", "off"),
								h.Class(twMerge(twMerge(...inputStyles), undefined)),
								h.Id(inputId(model.id)),
								...(viewInputs.placeholder
									? [h.Attribute("placeholder", viewInputs.placeholder)]
									: []),
								h.Role("combobox"),
								h.Attribute("spellcheck", "false"),
								h.Attribute("tabindex", "0"),
								h.Attribute("type", "text"),
								h.Value(model.inputValue),
								h.OnInput((value) => Message.ChangedInput({ value })),
								h.OnFocus(Message.FocusedInput()),
								h.OnBlur(Message.BlurredInput()),
								h.OnKeyDownPreventDefault((key) =>
									Array.contains(["ArrowDown", "ArrowUp", "Escape", "Enter"], key)
										? Option.some(Message.PressedInputKey({ key }))
										: Option.none(),
								),
							]),
						],
					),
					h.button(
						[
							...(isOpen ? [h.Attribute("aria-controls", listboxId(model.id))] : []),
							h.Attribute("aria-expanded", isOpen ? "true" : "false"),
							h.Attribute("aria-haspopup", "listbox"),
							h.Attribute("aria-label", "Show suggestions"),
							...(viewInputs.label === undefined
								? []
								: [
										h.Attribute(
											"aria-labelledby",
											`${buttonId(model.id)} ${labelId(model.id)}`,
										),
									]),
							h.Class(twMerge(twMerge(comboBoxButtonClassName), undefined)),
							...flag("data-pressed", isOpen),
							h.Attribute("data-react-aria-pressable", "true"),
							h.Id(buttonId(model.id)),
							h.Attribute("tabindex", "-1"),
							h.Attribute("type", "button"),
							h.OnMount(KeepInputFocus()),
							h.OnPointerDown((pointerType, button) =>
								button === 0 && pointerType !== "touch"
									? Option.some(Message.PressedButton())
									: Option.none(),
							),
						],
						[
							IconChevronUpDown(h, {
								className: comboBoxChevronClassName,
								attributes: { "data-slot": "chevron" },
							}),
							Option.match(open, {
								onNone: () => h.empty,
								onSome: (popup) => listPopover(model, popup, viewInputs, h),
							}),
						],
					),
				],
			),
		],
	)
})

const listPopover = (model: Model, open: Open, viewInputs: ViewInputs, h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Attribute("style", "display: contents;"), h.OnMount(PortalComboBox({ id: model.id }))],
		[
			h.span([
				h.Attribute("aria-hidden", "true"),
				h.Attribute("data-focus-scope-start", "true"),
				h.Attribute("hidden", ""),
			]),
			h.div(
				[h.Attribute("style", "display: contents;")],
				[
					h.div(
						[
							h.Class(
								twMerge(
									twMerge(...popoverContentBase),
									twMerge(twMerge(comboBoxPopoverBase), undefined),
								),
							),
							h.Attribute("data-popover", ""),
							h.Attribute("data-rac", ""),
							h.Attribute("data-trigger", "ComboBox"),
							h.Attribute("dir", "ltr"),
						],
						[
							h.div(
								[h.Class(popoverInnerClassName), h.Attribute("data-slot", "popover-inner")],
								[
									focusScopeSentinel(h, "start"),
									listbox(model, open, viewInputs, h),
									focusScopeSentinel(h, "end"),
								],
							),
							dismissButton(h, Message.BlurredInput()),
						],
					),
				],
			),
			h.span([
				h.Attribute("aria-hidden", "true"),
				h.Attribute("data-focus-scope-end", "true"),
				h.Attribute("hidden", ""),
			]),
		],
	)

const listbox = (model: Model, open: Open, viewInputs: ViewInputs, h: HtmlBuilder<Message>): Html =>
	h.div(
		[
			h.Attribute("aria-label", "Suggestions"),
			h.Attribute(
				"aria-labelledby",
				// useComboBox falls back to the button ("Show suggestions") without a Label.
				`${listboxId(model.id)} ${viewInputs.label === undefined ? buttonId(model.id) : labelId(model.id)}`,
			),
			h.Class(twMerge(twMerge(comboBoxListBoxBase), viewInputs.listBoxClassName)),
			h.Attribute("data-layout", "stack"),
			h.Attribute("data-orientation", "vertical"),
			h.Attribute("data-rac", ""),
			h.Id(listboxId(model.id)),
			h.Role("listbox"),
		],
		Array.map(visibleItems(model, open), (candidate) => option(model, open, candidate, h)),
	)

const option = (model: Model, open: Open, candidate: Item, h: HtmlBuilder<Message>): Html => {
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
			h.span(
				[
					h.Class(twMerge(dropdownLabelBase)),
					h.Id(optionLabelId(model.id, key)),
					h.Attribute("slot", "label"),
				],
				[candidate.label],
			),
		],
	)
}
