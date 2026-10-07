import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twJoin, twMerge } from "tailwind-merge"
import { fieldStyles } from "~/components/ui/field.styles"
import { searchFieldStyles } from "~/components/ui/search-field.styles"
import { IconClose, IconMagnifier3 } from "../icons"
import type * as Interaction from "./aria/interaction"
import { ariaButton } from "./button"
import * as Field from "./field"
import { type FieldInputContext, input, inputGroup, type InputOptions } from "./input"

/**
 * Port of `components/ui/search-field.tsx`. Escape and the clear button clear the value; the clear
 * button also focuses the input on press start, which the parent does with `searchFieldIds(id).input`.
 */
export interface SearchFieldOptions<Message> {
	readonly id: string
	readonly value: string
	readonly onInput?: (value: string) => Message
	/** Escape with a value, or a press on the clear button. */
	readonly onClear?: Message
	/** Pointer down on the clear button: focus the input (React Aria onPressStart). */
	readonly onClearPressStart?: Message
	/** Defaults to "Search", like the legacy wrapper. */
	readonly ariaLabel?: string
	readonly isDisabled?: boolean
	readonly isInvalid?: boolean
	readonly className?: string
	readonly interaction?: Interaction.Wiring<Message>
}

export interface SearchFieldParts<Message> {
	readonly label: (children: Array<Html | string>, options?: Field.PartOptions<Message>) => Html
	readonly description: (children: Array<Html | string>, options?: Field.PartOptions<Message>) => Html
	readonly fieldError: (children: Array<Html | string>, options?: Field.PartOptions<Message>) => Html
	readonly searchInput: (options?: InputOptions<Message>) => Html
}

export const searchFieldIds = (id: string) => ({
	input: `${id}-input`,
	label: `${id}-label`,
	description: `${id}-description`,
	error: `${id}-error`,
})

export const searchField = <Message>(
	h: HtmlBuilder<Message>,
	options: SearchFieldOptions<Message>,
	render: (parts: SearchFieldParts<Message>) => Array<Html>,
): Html => {
	const ids = searchFieldIds(options.id)
	const isDisabled = options.isDisabled ?? false
	const isInvalid = options.isInvalid ?? false
	const isEmpty = options.value === ""
	const ariaLabel = options.ariaLabel ?? "Search"
	const at = (target: string) => options.interaction && { wiring: options.interaction, target }

	const used = new Set<"label" | "description">()
	const partsFor = (hasLabel: boolean, hasDescription: boolean): SearchFieldParts<Message> => {
		const context: FieldInputContext<Message> = {
			id: ids.input,
			type: "search",
			ariaLabel,
			// With both an aria-label and a Label, React Aria labels the input by itself and the label.
			labelledBy: hasLabel ? `${ids.input} ${ids.label}` : undefined,
			describedBy:
				[...(hasDescription ? [ids.description] : []), ...(isInvalid ? [ids.error] : [])].join(" ") ||
				undefined,
			isDisabled,
			isInvalid,
			isRequired: false,
			value: options.value,
			onInput: options.onInput,
		}
		const escape =
			options.onClear === undefined || isDisabled
				? []
				: [
						h.OnKeyDownPreventDefault((key) =>
							key === "Escape" && !isEmpty && options.onClear !== undefined
								? Option.some(options.onClear)
								: Option.none(),
						),
					]
		return {
			label: (children, part = {}) => {
				used.add("label")
				return Field.label(h, { ...part, id: ids.label, htmlFor: ids.input }, children)
			},
			description: (children, part = {}) => {
				used.add("description")
				return Field.description(h, { ...part, id: ids.description }, children)
			},
			fieldError: (children, part = {}) =>
				isInvalid ? Field.fieldError(h, { ...part, id: ids.error }, children) : null,
			searchInput: (part = {}) =>
				inputGroup(
					h,
					{
						className: searchFieldStyles.group,
						isDisabled,
						isInvalid,
						interaction: at(`${options.id}-group`),
					},
					[
						IconMagnifier3(h, { className: searchFieldStyles.icon }),
						input(
							h,
							{
								interaction: at(ids.input),
								...part,
								attributes: [...escape, ...(part.attributes ?? [])],
							},
							context,
						),
						ariaButton(
							h,
							{
								className: twJoin(searchFieldStyles.clearButton),
								isDisabled,
								excludeFromTabOrder: true,
								preventFocusOnPress: true,
								onPress: options.onClear,
								interaction: at(`${options.id}-clear`),
								attributes: [
									h.AriaLabel("Clear search"),
									...(options.onClearPressStart === undefined || isDisabled
										? []
										: [h.OnMouseDown(options.onClearPressStart)]),
								],
							},
							[IconClose(h, { className: searchFieldStyles.clearIcon })],
						),
					],
				),
		}
	}
	render(partsFor(true, true))
	const children = render(partsFor(used.has("label"), used.has("description")))

	return h.div(
		[
			h.Class(twMerge(twMerge(fieldStyles({ className: searchFieldStyles.field })), options.className)),
			h.DataAttribute("rac", ""),
			...(isEmpty ? [h.DataAttribute("empty", "true")] : []),
			...(isDisabled ? [h.DataAttribute("disabled", "true")] : []),
			...(isInvalid ? [h.DataAttribute("invalid", "true")] : []),
		],
		children,
	)
}
