import { Schema } from "effect"
import { CustomElement } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	checkboxGroupStyles,
	checkboxIndicatorStyles,
	checkboxLayoutStyles,
	checkboxStyles,
} from "~/components/ui/checkbox.styles"
import { IconCheck, IconMinus } from "../icons"
import * as Collection from "./aria/collection"
import * as Interaction from "./aria/interaction"
import * as Field from "./field"

/**
 * Port of `components/ui/checkbox.tsx` (React Aria Checkbox). The `<label>` takes hover and press,
 * the visually hidden `<input>` takes focus. As in useToggle, pressing the label prevents the native
 * click, toggles, and focuses the input.
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
	/** Element id of the input and the interaction target. */
	readonly id: string
	readonly isSelected: boolean
	readonly isIndeterminate?: boolean
	readonly isDisabled?: boolean
	readonly isInvalid?: boolean
	/** Form value; inside a CheckboxGroup this is the item's value. */
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
	readonly interaction?: Interaction.Wiring<Message>
}

export const checkbox = <Message>(
	h: HtmlBuilder<Message>,
	options: CheckboxOptions<Message>,
	children: string | Array<Html>,
): Html => {
	const isDisabled = options.isDisabled ?? false
	const isInvalid = options.isInvalid ?? false
	const isIndeterminate = options.isIndeterminate ?? false
	const interaction = options.interaction
	const state = interaction ? Interaction.stateOf(interaction.model, options.id) : Interaction.idleState
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
			h.DataAttribute("rac", ""),
			h.DataAttribute("react-aria-pressable", "true"),
			h.DataAttribute("slot", "control"),
			...(options.slot === undefined ? [] : [h.Attribute("slot", options.slot)]),
			...(options.isSelected ? [h.DataAttribute("selected", "true")] : []),
			...(isIndeterminate ? [h.DataAttribute("indeterminate", "true")] : []),
			...(isDisabled ? [h.DataAttribute("disabled", "true")] : []),
			...(isInvalid ? [h.DataAttribute("invalid", "true")] : []),
			...(interaction
				? [
						...Interaction.handlers(h, interaction, options.id, {
							isHoverDisabled: isDisabled,
							isPressDisabled: isDisabled,
							isFocusDisabled: true,
						}),
						...Interaction.stateAttributes(h, state),
						...Interaction.pressStyleAttributes(h, interaction.model, options.id),
					]
				: []),
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
						...(interaction
							? Interaction.handlers(h, interaction, options.id, {
									isHoverDisabled: true,
									isPressDisabled: true,
									isFocusDisabled: isDisabled,
								})
							: []),
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
										isFocusVisible: state.isFocusVisible,
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

export interface CheckboxGroupOptions<Message> {
	readonly id: string
	readonly value: ReadonlyArray<string>
	readonly onChange?: (value: ReadonlyArray<string>) => Message
	readonly isInvalid?: boolean
	readonly isDisabled?: boolean
	readonly className?: string
	readonly interaction?: Interaction.Wiring<Message>
}

export interface CheckboxGroupParts<Message> {
	readonly label: (children: Array<Html | string>, options?: Field.PartOptions<Message>) => Html
	readonly description: (children: Array<Html | string>, options?: Field.PartOptions<Message>) => Html
	readonly fieldError: (children: Array<Html | string>, options?: Field.PartOptions<Message>) => Html
	/** A checkbox whose selection, invalid and disabled state come from the group. */
	readonly checkbox: (
		value: string,
		children: string | Array<Html>,
		options?: { readonly className?: string },
	) => Html
}

/** React Aria CheckboxGroup: `role="group"`, labelled by its Label (rendered as a span). */
export const checkboxGroup = <Message>(
	h: HtmlBuilder<Message>,
	options: CheckboxGroupOptions<Message>,
	render: (parts: CheckboxGroupParts<Message>) => Array<Html>,
): Html => {
	const ids = {
		label: `${options.id}-label`,
		description: `${options.id}-description`,
		error: `${options.id}-error`,
	}
	const isInvalid = options.isInvalid ?? false
	const onChange = options.onChange
	const used = new Set<"label" | "description">()
	const describedBy = (hasDescription: boolean) =>
		[...(hasDescription ? [ids.description] : []), ...(isInvalid ? [ids.error] : [])].join(" ") ||
		undefined
	const partsFor = (hasDescription: boolean): CheckboxGroupParts<Message> => ({
		label: (children, part = {}) => {
			used.add("label")
			return Field.label(h, { ...part, id: ids.label, elementType: "span" }, children)
		},
		description: (children, part = {}) => {
			used.add("description")
			return Field.description(h, { ...part, id: ids.description }, children)
		},
		fieldError: (children, part = {}) =>
			isInvalid ? Field.fieldError(h, { ...part, id: ids.error }, children) : null,
		checkbox: (value, children, part = {}) => {
			const isSelected = options.value.includes(value)
			return checkbox(
				h,
				{
					id: `${options.id}-${value}`,
					isSelected,
					value,
					isInvalid,
					isDisabled: options.isDisabled,
					describedBy: isInvalid ? describedBy(hasDescription) : undefined,
					onChange: onChange
						? (next) =>
								onChange(
									next
										? [...options.value, value]
										: options.value.filter((item) => item !== value),
								)
						: undefined,
					interaction: options.interaction,
					className: part.className,
				},
				children,
			)
		},
	})
	render(partsFor(true))
	const children = render(partsFor(used.has("description")))
	const groupDescribedBy = describedBy(used.has("description"))
	return h.div(
		[
			h.Class(twMerge(twMerge(checkboxGroupStyles), options.className)),
			h.DataAttribute("rac", ""),
			h.DataAttribute("slot", "control"),
			h.Role("group"),
			h.Id(options.id),
			...(used.has("label") ? [h.AriaLabelledBy(ids.label)] : []),
			...(groupDescribedBy === undefined ? [] : [h.AriaDescribedBy(groupDescribedBy)]),
			...(isInvalid ? [h.DataAttribute("invalid", "true")] : []),
			...(options.isDisabled ? [h.DataAttribute("disabled", "true")] : []),
		],
		children,
	)
}
