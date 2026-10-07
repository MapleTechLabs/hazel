import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { inputControlStyles, inputGroupStyles, inputStyles } from "~/components/ui/input.styles"
import * as Interaction from "./aria/interaction"

/** Port of `components/ui/input.tsx` (React Aria Input inside a `data-slot="control"` span). */
export interface InteractionTarget<Message> {
	readonly wiring: Interaction.Wiring<Message>
	readonly target: string
}

/** What a TextField hands its Input through React Aria context. */
export interface FieldInputContext<Message> {
	readonly id: string
	readonly labelledBy?: string
	readonly describedBy?: string
	readonly isDisabled: boolean
	readonly isInvalid: boolean
	readonly isRequired: boolean
	readonly value: string
	readonly onInput?: (value: string) => Message
}

export interface InputOptions<Message> {
	readonly className?: string
	readonly placeholder?: string
	readonly isDisabled?: boolean
	readonly isInvalid?: boolean
	/** Uncontrolled initial value: React writes it as the `value` attribute and never updates it. */
	readonly defaultValue?: string
	readonly interaction?: InteractionTarget<Message>
	readonly attributes?: ReadonlyArray<Attribute<Message>>
}

/** The `<input>` element alone, with React Aria's attributes and state. */
export const inputElement = <Message>(
	h: HtmlBuilder<Message>,
	options: InputOptions<Message>,
	field?: FieldInputContext<Message>,
): Html => {
	const isDisabled = field?.isDisabled ?? options.isDisabled ?? false
	const isInvalid = field?.isInvalid ?? options.isInvalid ?? false
	const interaction = options.interaction
	const fieldAttributes = field
		? [
				h.Id(field.id),
				...(field.labelledBy === undefined ? [] : [h.AriaLabelledBy(field.labelledBy)]),
				...(field.describedBy === undefined ? [] : [h.AriaDescribedBy(field.describedBy)]),
				h.Type("text"),
				...(isDisabled ? [] : [h.Tabindex(0), h.Attribute("title", "")]),
				...(field.isRequired ? [h.Required(true)] : []),
				h.Value(field.value),
				...(field.onInput === undefined ? [] : [h.OnInput(field.onInput)]),
			]
		: options.defaultValue === undefined
			? []
			: [h.Attribute("value", options.defaultValue)]
	return h.input([
		h.Class(twMerge(twMerge(...inputStyles), options.className)),
		h.DataAttribute("rac", ""),
		h.Attribute("style", ""),
		...(options.placeholder === undefined ? [] : [h.Placeholder(options.placeholder)]),
		...(isDisabled ? [h.Disabled(true), h.DataAttribute("disabled", "true")] : []),
		...(isInvalid ? [h.AriaInvalid(true), h.DataAttribute("invalid", "true")] : []),
		...fieldAttributes,
		...(interaction
			? [
					...Interaction.handlers(h, interaction.wiring, interaction.target, {
						isHoverDisabled: isDisabled,
						isPressDisabled: true,
						isFocusDisabled: isDisabled,
						isTextInput: true,
					}),
					...Interaction.stateAttributes(
						h,
						Interaction.stateOf(interaction.wiring.model, interaction.target),
					),
				]
			: []),
		...(options.attributes ?? []),
	])
}

export const input = <Message>(
	h: HtmlBuilder<Message>,
	options: InputOptions<Message>,
	field?: FieldInputContext<Message>,
): Html =>
	h.span(
		[h.DataAttribute("slot", "control"), h.Class(inputControlStyles)],
		[inputElement(h, options, field)],
	)

/** React Aria Group (`role="group"`) that lays out icons, loaders, text and buttons around an Input. */
export const inputGroup = <Message>(
	h: HtmlBuilder<Message>,
	options: {
		readonly className?: string
		readonly interaction?: InteractionTarget<Message>
		readonly attributes?: ReadonlyArray<Attribute<Message>>
	},
	children: Array<Html | string>,
): Html =>
	h.div(
		[
			h.Class(twMerge(twMerge(...inputGroupStyles), options.className)),
			h.DataAttribute("rac", ""),
			h.DataAttribute("slot", "control"),
			h.Role("group"),
			...(options.interaction
				? [
						...Interaction.handlers(h, options.interaction.wiring, options.interaction.target, {
							isPressDisabled: true,
							isWithin: true,
						}),
						...Interaction.stateAttributes(
							h,
							Interaction.stateOf(options.interaction.wiring.model, options.interaction.target),
						),
					]
				: []),
			...(options.attributes ?? []),
		],
		children,
	)
