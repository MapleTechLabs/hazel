import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	radioGroupStyles,
	radioIndicatorStyles,
	radioLayoutStyles,
	radioStyles,
} from "~/components/ui/radio.styles"
import * as Collection from "./aria/collection"
import * as Interaction from "./aria/interaction"
import { visuallyHiddenStyle } from "./checkbox"
import * as Field from "./field"

/**
 * Port of `components/ui/radio.tsx` (React Aria RadioGroup and Radio). Radios share the group id as
 * their `name`, so the browser's arrow-key navigation moves selection and focus like useRadioGroup.
 * Pressing a label prevents the native click, selects, and focuses the input (useRadio).
 */
export interface RadioGroupOptions<Message> {
	readonly id: string
	readonly value: string | null
	readonly onChange?: (value: string) => Message
	readonly isDisabled?: boolean
	readonly isInvalid?: boolean
	readonly className?: string
	readonly interaction?: Interaction.Wiring<Message>
}

export interface RadioGroupParts<Message> {
	readonly label: (children: Array<Html | string>, options?: Field.PartOptions<Message>) => Html
	readonly description: (children: Array<Html | string>, options?: Field.PartOptions<Message>) => Html
	readonly fieldError: (children: Array<Html | string>, options?: Field.PartOptions<Message>) => Html
	readonly radio: (
		value: string,
		children: string | Array<Html>,
		options?: { readonly className?: string },
	) => Html
}

export const radioGroup = <Message>(
	h: HtmlBuilder<Message>,
	options: RadioGroupOptions<Message>,
	render: (parts: RadioGroupParts<Message>) => Array<Html>,
): Html => {
	const ids = {
		label: `${options.id}-label`,
		description: `${options.id}-description`,
		error: `${options.id}-error`,
	}
	const isDisabled = options.isDisabled ?? false
	const isInvalid = options.isInvalid ?? false
	const interaction = options.interaction
	const used = new Set<"label" | "description">()
	const describedBy = (hasDescription: boolean) =>
		[...(hasDescription ? [ids.description] : []), ...(isInvalid ? [ids.error] : [])].join(" ") ||
		undefined

	const radio =
		(hasDescription: boolean) =>
		(value: string, children: string | Array<Html>, part: { readonly className?: string } = {}) => {
			const id = `${options.id}-${value}`
			const isSelected = options.value === value
			const state = interaction ? Interaction.stateOf(interaction.model, id) : Interaction.idleState
			const select = options.onChange?.(value)
			const inputDescribedBy = describedBy(hasDescription)
			// Roving tabindex: the selected radio, or every radio while nothing is selected.
			const tabIndex = options.value === null || isSelected ? 0 : -1
			const content =
				typeof children === "string"
					? [Field.label(h, { id: ids.label, elementType: "span" }, [children])]
					: children
			return h.label(
				[
					h.Class(twMerge(twMerge(radioStyles), part.className)),
					h.DataAttribute("rac", ""),
					h.DataAttribute("react-aria-pressable", "true"),
					...(isSelected ? [h.DataAttribute("selected", "true")] : []),
					...(isDisabled ? [h.DataAttribute("disabled", "true")] : []),
					...(isInvalid ? [h.DataAttribute("invalid", "true")] : []),
					...(interaction
						? [
								...Interaction.handlers(h, interaction, id, {
									isHoverDisabled: isDisabled,
									isPressDisabled: isDisabled,
									isFocusDisabled: true,
								}),
								...Interaction.stateAttributes(h, state),
								...Interaction.pressStyleAttributes(h, interaction.model, id),
							]
						: []),
					...(select === undefined || isDisabled
						? []
						: [
								h.OnClick(select, {
									defaultAction: "Prevent",
									focusSelector: Collection.idAttributeSelector(id),
								}),
							]),
				],
				[
					h.span(
						[h.Attribute("style", visuallyHiddenStyle)],
						[
							h.input([
								h.Id(id),
								h.Type("radio"),
								h.Name(options.id),
								h.Attribute("value", value),
								h.DataAttribute("react-aria-pressable", "true"),
								h.Attribute("style", ""),
								...(isDisabled
									? [h.Disabled(true)]
									: [h.Tabindex(tabIndex), h.Attribute("title", "")]),
								...(inputDescribedBy === undefined
									? []
									: [h.AriaDescribedBy(inputDescribedBy)]),
								h.Checked(isSelected),
								...(interaction
									? Interaction.handlers(h, interaction, id, {
											isHoverDisabled: true,
											isPressDisabled: true,
											isFocusDisabled: isDisabled,
										})
									: []),
								// Arrow keys check the next radio natively; the Model follows.
								...(select === undefined ? [] : [h.OnChange(() => select)]),
							]),
						],
					),
					h.div(
						[h.Class(twMerge(...radioLayoutStyles))],
						[
							h.span(
								[
									h.DataAttribute("slot", "indicator"),
									h.Class(
										twMerge(
											radioIndicatorStyles({
												isSelected,
												isFocusVisible: state.isFocusVisible,
												isInvalid,
											}),
										),
									),
								],
								[],
							),
							...content,
						],
					),
				],
			)
		}

	const partsFor = (hasDescription: boolean): RadioGroupParts<Message> => ({
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
		radio: radio(hasDescription),
	})
	render(partsFor(true))
	const children = render(partsFor(used.has("description")))
	const groupDescribedBy = describedBy(used.has("description"))

	return h.div(
		[
			h.Class(twMerge(twMerge(...radioGroupStyles), options.className)),
			h.DataAttribute("rac", ""),
			h.DataAttribute("slot", "control"),
			h.DataAttribute("orientation", "vertical"),
			h.Role("radiogroup"),
			h.Id(options.id),
			h.AriaOrientation("vertical"),
			...(used.has("label") ? [h.AriaLabelledBy(ids.label)] : []),
			...(groupDescribedBy === undefined ? [] : [h.AriaDescribedBy(groupDescribedBy)]),
			...(isDisabled ? [h.AriaDisabled(true), h.DataAttribute("disabled", "true")] : []),
			...(isInvalid ? [h.AriaInvalid(true), h.DataAttribute("invalid", "true")] : []),
		],
		children,
	)
}
