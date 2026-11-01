import { Schema } from "effect"
import { CustomElement } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	checkboxIndicatorStyles,
	checkboxLayoutStyles,
	checkboxStyles,
} from "~/components/ui/checkbox.styles"
import { IconCheck, IconMinus } from "../icons"
import * as Collection from "./aria/collection"
import * as Field from "./field"

/**
 * A checkbox: the `<label>` takes the pointer, the visually hidden `<input>` takes focus. Pressing the
 * label prevents the native click, toggles, and focuses the input. Hover and the keyboard focus ring
 * are native CSS on the label (`group-hover`, `group-has-focus-visible`).
 */
export const visuallyHiddenStyle =
	"border: 0px; clip: rect(0px, 0px, 0px, 0px); clip-path: inset(50%); height: 1px; margin: -1px; overflow: hidden; padding: 0px; position: absolute; width: 1px; white-space: nowrap;"

/**
 * useCheckbox sets `input.indeterminate`, a DOM property with no attribute. A CustomElement spec is
 * Foldkit's public way to build a property attribute; it is applied to the native input here.
 */
const indeterminateProperty = CustomElement.define({
	tag: "hazel-indeterminate",
	properties: { indeterminate: Schema.Boolean },
	events: {},
})

export interface CheckboxOptions<Message> {
	/** Element id of the input. */
	readonly id: string
	readonly isSelected: boolean
	readonly isIndeterminate?: boolean
	readonly isDisabled?: boolean
	readonly isInvalid?: boolean
	/** Form value. */
	readonly value?: string
	readonly describedBy?: string
	/** React Aria slot, e.g. `selection` for a GridList row's checkbox. */
	readonly slot?: string
	readonly ariaLabel?: string
	readonly labelledBy?: string
	/** usePress stops press events at the checkbox, so an enclosing row does not also react. */
	readonly stopsClickPropagation?: boolean
	readonly onChange?: (isSelected: boolean) => Message
	readonly className?: string
}

export const checkbox = <Message>(
	h: HtmlBuilder<Message>,
	options: CheckboxOptions<Message>,
	children: string | Array<Html>,
): Html => {
	const isDisabled = options.isDisabled ?? false
	const isInvalid = options.isInvalid ?? false
	const isIndeterminate = options.isIndeterminate ?? false
	const toggle = options.onChange?.(!options.isSelected)
	const indicator = isIndeterminate
		? IconMinus(h, { attributes: { "data-slot": "check-indicator" } })
		: options.isSelected
			? IconCheck(h, { attributes: { "data-slot": "check-indicator" } })
			: null
	const content =
		typeof children === "string" ? [Field.label(h, { elementType: "span" }, [children])] : children

	return h.label(
		[
			h.Class(twMerge(twMerge(checkboxStyles), options.className)),
			h.DataAttribute("react-aria-pressable", "true"),
			h.DataAttribute("slot", "control"),
			...(options.slot === undefined ? [] : [h.Attribute("slot", options.slot)]),
			...(options.isSelected ? [h.DataAttribute("selected", "true")] : []),
			...(isIndeterminate ? [h.DataAttribute("indeterminate", "true")] : []),
			...(isDisabled ? [h.DataAttribute("disabled", "true")] : []),
			...(isInvalid ? [h.DataAttribute("invalid", "true")] : []),
			...(toggle === undefined || isDisabled
				? []
				: [
						h.OnClick(toggle, {
							defaultAction: "Prevent",
							focusSelector: Collection.idAttributeSelector(options.id),
							...(options.stopsClickPropagation ? { propagation: "Stop" as const } : {}),
						}),
					]),
		],
		[
			h.span(
				[h.Attribute("style", visuallyHiddenStyle)],
				[
					h.input([
						h.Id(options.id),
						h.Type("checkbox"),
						h.DataAttribute("react-aria-pressable", "true"),
						h.Attribute("style", ""),
						...(isDisabled ? [h.Disabled(true)] : [h.Tabindex(0), h.Attribute("title", "")]),
						...(isInvalid ? [h.AriaInvalid(true)] : []),
						...(options.ariaLabel === undefined ? [] : [h.AriaLabel(options.ariaLabel)]),
						...(options.labelledBy === undefined ? [] : [h.AriaLabelledBy(options.labelledBy)]),
						...(options.describedBy === undefined
							? []
							: [h.AriaDescribedBy(options.describedBy)]),
						...(options.value === undefined ? [] : [h.Attribute("value", options.value)]),
						// Foldkit mirrors the live value into the `checked` attribute; React keeps the initial one.
						h.Checked(options.isSelected),
						indeterminateProperty.withMessage(h).Indeterminate(isIndeterminate),
						// Space toggles natively; the Model follows like React Aria's onChange.
						...(toggle === undefined ? [] : [h.OnChange(() => toggle)]),
					]),
				],
			),
			h.div(
				[h.Class(twMerge(...checkboxLayoutStyles))],
				[
					h.span(
						[
							h.DataAttribute("slot", "indicator"),
							h.Class(
								twMerge(
									checkboxIndicatorStyles({
										isSelected: options.isSelected,
										isIndeterminate,
										isInvalid,
									}),
								),
							),
						],
						[indicator],
					),
					...content,
				],
			),
		],
	)
}
