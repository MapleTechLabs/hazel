import type { Html, HtmlBuilder, TextareaAttribute } from "foldkit/html"
import { twJoin, twMerge } from "tailwind-merge"
import { textareaControlStyles, textareaStyles } from "~/components/ui/textarea.styles"
import * as Interaction from "./aria/interaction"
import type { FieldInputContext, InteractionTarget } from "./input"

/** Port of `components/ui/textarea.tsx` (React Aria TextArea inside a `data-slot="control"` span). */
export interface TextareaOptions<Message> {
	readonly className?: string
	readonly placeholder?: string
	readonly isDisabled?: boolean
	readonly isInvalid?: boolean
	readonly interaction?: InteractionTarget<Message>
	readonly attributes?: ReadonlyArray<TextareaAttribute<Message>>
}

export const textarea = <Message>(
	h: HtmlBuilder<Message>,
	options: TextareaOptions<Message>,
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
				...(isDisabled ? [] : [h.Tabindex(0), h.Attribute("title", "")]),
				...(field.isRequired ? [h.Required(true)] : []),
				h.Value(field.value),
				...(field.onInput === undefined ? [] : [h.OnInput(field.onInput)]),
			]
		: []
	return h.span(
		[h.DataAttribute("slot", "control"), h.Class(textareaControlStyles)],
		[
			h.textarea([
				h.Class(twMerge(twMerge(twJoin(textareaStyles)), options.className)),
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
			]),
		],
	)
}
