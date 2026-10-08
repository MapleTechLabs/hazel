import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { fieldStyles } from "~/components/ui/field.styles"
import type * as Interaction from "./aria/interaction"
import * as Field from "./field"
import { type FieldInputContext, input, type InputOptions } from "./input"
import { textarea, type TextareaOptions } from "./textarea"

/**
 * Port of `components/ui/text-field.tsx`. React Aria wires Label, Input/TextArea, Description and
 * FieldError through context; here the field hands `render` those parts with ids and state bound.
 */
export interface TextFieldOptions<Message> {
	/** Base for the element ids (`<id>-input`, `<id>-label`, ...) and the input's interaction target. */
	readonly id: string
	readonly value: string
	readonly onInput?: (value: string) => Message
	readonly isInvalid?: boolean
	readonly isDisabled?: boolean
	readonly isRequired?: boolean
	readonly className?: string
	readonly interaction?: Interaction.Wiring<Message>
}

export interface TextFieldParts<Message> {
	readonly label: (children: Array<Html | string>, options?: Field.PartOptions<Message>) => Html
	readonly description: (children: Array<Html | string>, options?: Field.PartOptions<Message>) => Html
	/** Renders only while the field is invalid, like React Aria's FieldError. */
	readonly fieldError: (children: Array<Html | string>, options?: Field.PartOptions<Message>) => Html
	readonly input: (options?: InputOptions<Message>) => Html
	readonly textarea: (options?: TextareaOptions<Message>) => Html
}

export const textFieldIds = (id: string) => ({
	input: `${id}-input`,
	label: `${id}-label`,
	description: `${id}-description`,
	error: `${id}-error`,
})

export const textField = <Message>(
	h: HtmlBuilder<Message>,
	options: TextFieldOptions<Message>,
	render: (parts: TextFieldParts<Message>) => Array<Html>,
): Html => {
	const ids = textFieldIds(options.id)
	const isInvalid = options.isInvalid ?? false
	const isDisabled = options.isDisabled ?? false

	// React Aria's useSlot: the input is described by a Description only if one renders.
	const used = new Set<"label" | "description">()
	const partsFor = (hasLabel: boolean, hasDescription: boolean): TextFieldParts<Message> => {
		const context: FieldInputContext<Message> = {
			id: ids.input,
			labelledBy: hasLabel ? ids.label : undefined,
			describedBy:
				[...(hasDescription ? [ids.description] : []), ...(isInvalid ? [ids.error] : [])].join(" ") ||
				undefined,
			isDisabled,
			isInvalid,
			isRequired: options.isRequired ?? false,
			value: options.value,
			onInput: options.onInput,
		}
		const target = options.interaction && { wiring: options.interaction, target: ids.input }
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
			input: (part = {}) => input(h, { interaction: target, ...part }, context),
			textarea: (part = {}) => textarea(h, { interaction: target, ...part }, context),
		}
	}
	render(partsFor(true, true))
	const children = render(partsFor(used.has("label"), used.has("description")))

	return h.div(
		[
			h.Class(twMerge(twMerge(fieldStyles()), options.className)),
			h.DataAttribute("rac", ""),
			h.DataAttribute("slot", "control"),
			...(isInvalid ? [h.DataAttribute("invalid", "true")] : []),
			...(isDisabled ? [h.DataAttribute("disabled", "true")] : []),
			...(options.isRequired ? [h.DataAttribute("required", "true")] : []),
		],
		children,
	)
}
