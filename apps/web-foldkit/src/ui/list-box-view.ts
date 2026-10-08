import { Array, Option } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	dropdownCheckIndicatorClassName,
	dropdownDescriptionBase,
	dropdownItemStyles,
	dropdownKeyboardBase,
	dropdownLabelBase,
	dropdownSectionStyles,
	dropdownSeparatorBase,
} from "~/components/ui/dropdown.styles"
import { keyboardStyles } from "~/components/ui/keyboard.styles"
import {
	listBoxBase,
	listBoxCheckIconClassName,
	listBoxItemClassName,
	listBoxSectionClassName,
} from "~/components/ui/list-box.styles"
import { IconCheck } from "../icons"
import { focusScopeSentinel } from "./aria/overlay"
import { descriptionId, type Item, labelId, listId, Message, type Model, optionId } from "./list-box"

/** Port of the ListBox markup (`list-box.tsx`, `dropdown.tsx`), React Aria's DOM included. */

// CONTENT HELPERS

/** `ListBoxLabel` / `DropdownLabel`: the option's accessible name. */
export const listBoxLabel = <M>(
	h: HtmlBuilder<M>,
	id: string,
	key: string,
	text: string,
	className?: string,
) =>
	h.span(
		[
			h.Class(twMerge(dropdownLabelBase, className)),
			h.Id(labelId(id, key)),
			h.Attribute("slot", "label"),
		],
		[text],
	)

/** `ListBoxDescription` / `DropdownDescription`. */
export const listBoxDescription = <M>(h: HtmlBuilder<M>, id: string, key: string, text: string) =>
	h.span(
		[
			h.Class(twMerge(dropdownDescriptionBase)),
			h.Id(descriptionId(id, key)),
			h.Attribute("slot", "description"),
		],
		[text],
	)

/** `DropdownKeyboard` over `Keyboard`. */
export const dropdownKeyboard = <M>(h: HtmlBuilder<M>, text: string) =>
	h.kbd(
		[
			h.Class(twMerge(keyboardStyles, twMerge(dropdownKeyboardBase))),
			h.Attribute("data-slot", "keyboard"),
			h.Attribute("dir", "ltr"),
		],
		[text],
	)

// VIEW

export type ViewInputs = Readonly<{
	ariaLabel: string
	/** Option children after the check icon; defaults to a label with the item's text. */
	content?: (key: string) => ReadonlyArray<Html>
	className?: string
}>

const flag = (h: HtmlBuilder<Message>, name: string, isOn: boolean) =>
	isOn ? [h.Attribute(name, "true")] : []

const option = (h: HtmlBuilder<Message>, model: Model, viewInputs: ViewInputs, entry: Item): Html => {
	const { key } = entry
	const isFocused = model.isFocusWithin && Option.contains(model.focusedKey, key)
	const isSelected = model.selectedKeys.includes(key)
	const allowsSelection = model.selectionMode !== "none"
	const isHovered = allowsSelection && !entry.isDisabled && Option.contains(model.hoveredKey, key)
	const isPressed = Option.contains(model.pressedKey, key)
	const isFocusVisible = isFocused && model.modality !== "Pointer"
	const renderProps = {
		isSelected,
		isFocused,
		isHovered,
		isDisabled: entry.isDisabled,
		isPressed,
		isFocusVisible,
	}
	const className =
		entry.flavor === "ListBox"
			? dropdownItemStyles({ ...renderProps, className: listBoxItemClassName(false, undefined) })
			: dropdownItemStyles({ ...renderProps, intent: entry.intent ?? undefined, className: undefined })
	const check = isSelected
		? entry.flavor === "ListBox"
			? [
					IconCheck(h, {
						className: listBoxCheckIconClassName,
						attributes: { "data-slot": "check-icon" },
					}),
				]
			: [
					IconCheck(h, {
						className: dropdownCheckIndicatorClassName,
						attributes: { "data-slot": "check-indicator" },
					}),
				]
		: []
	const content = viewInputs.content?.(key) ?? [listBoxLabel(h, model.id, key, entry.textValue)]
	return h.keyed("div")(
		key,
		[
			...(entry.hasDescription ? [h.Attribute("aria-describedby", descriptionId(model.id, key))] : []),
			...flag(h, "aria-disabled", entry.isDisabled),
			h.Attribute("aria-labelledby", labelId(model.id, key)),
			...(allowsSelection ? [h.Attribute("aria-selected", isSelected ? "true" : "false")] : []),
			h.Class(className),
			h.Attribute("data-collection", listId(model.id)),
			...flag(h, "data-disabled", entry.isDisabled),
			...flag(h, "data-focus-visible", isFocusVisible),
			...flag(h, "data-focused", isFocused),
			...flag(h, "data-hovered", isHovered),
			h.Attribute("data-key", key),
			...flag(h, "data-pressed", isPressed),
			h.Attribute("data-rac", ""),
			...(entry.isDisabled ? [] : [h.Attribute("data-react-aria-pressable", "true")]),
			...flag(h, "data-selected", isSelected),
			...(allowsSelection ? [h.Attribute("data-selection-mode", model.selectionMode)] : []),
			...(entry.flavor === "ListBox" ? [h.Attribute("data-slot", "list-box-item")] : []),
			h.Id(optionId(model.id, key)),
			h.Role("option"),
			...(entry.isDisabled
				? []
				: [
						h.Attribute("tabindex", Option.contains(model.focusedKey, key) ? "0" : "-1"),
						h.OnMouseEnter(Message.HoveredItem({ key })),
						h.OnPointerLeave(() => Option.some(Message.UnhoveredItem({ key }))),
						h.OnPointerDown((_pointerType, button) =>
							Option.some(Message.PressedItem({ key, button })),
						),
						h.OnFocus(Message.FocusedItem({ key })),
					]),
		],
		[...check, ...content],
	)
}

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const { section, header } = dropdownSectionStyles()
	const children = Array.map(model.entries, (entry, index) => {
		if (entry._tag === "Item") return option(h, model, viewInputs, entry.item)
		if (entry._tag === "Separator")
			return h.div([h.Class(twMerge(dropdownSeparatorBase)), h.Role("separator")])
		const headerId = `${listId(model.id)}-section-${index}`
		return h.section(
			[
				...(entry.title === null ? [] : [h.Attribute("aria-labelledby", headerId)]),
				h.Class(
					section({
						className: entry.isListBoxSection ? listBoxSectionClassName(undefined) : undefined,
					}),
				),
				h.Attribute("data-rac", ""),
				h.Role("group"),
			],
			[
				...(entry.title === null
					? []
					: [h.header([h.Class(header()), h.Id(headerId), h.Role("presentation")], [entry.title])]),
				...Array.map(entry.items, (item) => option(h, model, viewInputs, item)),
			],
		)
	})
	return h.div(
		[
			h.AriaLabel(viewInputs.ariaLabel),
			...(model.selectionMode === "multiple" ? [h.Attribute("aria-multiselectable", "true")] : []),
			h.Class(twMerge(twMerge(listBoxBase), viewInputs.className)),
			h.Attribute("data-collection", listId(model.id)),
			h.Attribute("data-layout", "stack"),
			h.Attribute("data-orientation", "vertical"),
			h.Attribute("data-rac", ""),
			h.Id(listId(model.id)),
			h.Role("listbox"),
			h.Attribute("tabindex", Option.isSome(model.focusedKey) ? "-1" : "0"),
			h.OnFocus(Message.FocusedList({ isFromAfter: false })),
			h.OnFocusLeave(Message.LeftList()),
			h.OnKeyDownPreventDefault((key, modifiers) =>
				key === "Tab"
					? Option.none()
					: Option.some(
							Message.PressedKey({
								key,
								isModified: modifiers.metaKey || modifiers.ctrlKey || modifiers.altKey,
							}),
						),
			),
			h.OnKeyUp((key) => Message.ReleasedKey({ key })),
		],
		children,
	)
})

/** A standalone ListBox sits in a FocusScope: hidden sentinels around it, which the host renders. */
export const withFocusScope = <M>(h: HtmlBuilder<M>, listBox: Html): ReadonlyArray<Html> => [
	focusScopeSentinel(h, "start"),
	listBox,
	focusScopeSentinel(h, "end"),
]
