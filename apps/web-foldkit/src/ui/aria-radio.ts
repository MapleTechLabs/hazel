import type { Html, HtmlBuilder } from "foldkit/html"
import * as Interaction from "./aria/interaction"
import { visuallyHiddenStyle } from "./checkbox"

/**
 * React Aria's unstyled `RadioGroup` and `Radio` (react-aria-components), for screens that pass
 * their own className (or RAC's default `react-aria-*` class) and render-prop children. The styled
 * kit version is `radio.ts`.
 */
export interface AriaRadioGroupOptions<Message> {
	readonly id: string
	readonly value: string | null
	readonly onChange?: (value: string) => Message
	readonly ariaLabel?: string
	readonly isDisabled?: boolean
	readonly className?: string
	readonly interaction?: Interaction.Wiring<Message>
}

/** The render-prop values a `Radio` child function receives. */
export interface AriaRadioState {
	readonly isSelected: boolean
	readonly isHovered: boolean
	readonly isPressed: boolean
	readonly isFocused: boolean
	readonly isFocusVisible: boolean
	readonly isDisabled: boolean
}

export type AriaRadio = (
	value: string,
	options: { readonly className?: string; readonly ariaLabel?: string },
	children: (state: AriaRadioState) => Array<Html>,
) => Html

export const ariaRadioGroup = <Message>(
	h: HtmlBuilder<Message>,
	options: AriaRadioGroupOptions<Message>,
	render: (radio: AriaRadio) => Array<Html>,
): Html => {
	const isDisabled = options.isDisabled ?? false
	const interaction = options.interaction

	const radio: AriaRadio = (value, part, children) => {
		const id = `${options.id}-${value}`
		const isSelected = options.value === value
		const interactionState = interaction
			? Interaction.stateOf(interaction.model, id)
			: Interaction.idleState
		const select = options.onChange?.(value)
		// Roving tabindex: the selected radio, or every radio while nothing is selected.
		const tabIndex = options.value === null || isSelected ? 0 : -1
		const state: AriaRadioState = {
			isSelected,
			isHovered: interactionState.isHovered,
			isPressed: interactionState.isPressed,
			isFocused: interactionState.isFocused,
			isFocusVisible: interactionState.isFocusVisible,
			isDisabled,
		}
		return h.label(
			[
				h.Class(part.className ?? "react-aria-Radio"),
				h.DataAttribute("rac", ""),
				h.DataAttribute("react-aria-pressable", "true"),
				...(isSelected ? [h.DataAttribute("selected", "true")] : []),
				...(isDisabled ? [h.DataAttribute("disabled", "true")] : []),
				...(interaction
					? [
							...Interaction.handlers(h, interaction, id, {
								isHoverDisabled: isDisabled,
								isPressDisabled: isDisabled,
								isFocusDisabled: true,
							}),
							...Interaction.stateAttributes(h, interactionState),
							...Interaction.pressStyleAttributes(h, interaction.model, id),
						]
					: []),
				...(select === undefined || isDisabled
					? []
					: [h.OnClick(select, { defaultAction: "Prevent", focusSelector: `#${id}` })]),
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
							...(part.ariaLabel === undefined ? [] : [h.AriaLabel(part.ariaLabel)]),
							...(isDisabled
								? [h.Disabled(true)]
								: [h.Tabindex(tabIndex), h.Attribute("title", "")]),
							h.Checked(isSelected),
							...(interaction
								? Interaction.handlers(h, interaction, id, {
										isHoverDisabled: true,
										isPressDisabled: true,
										isFocusDisabled: isDisabled,
									})
								: []),
							...(select === undefined ? [] : [h.OnChange(() => select)]),
						]),
					],
				),
				...children(state),
			],
		)
	}

	return h.div(
		[
			h.Class(options.className ?? "react-aria-RadioGroup"),
			h.DataAttribute("rac", ""),
			h.DataAttribute("orientation", "vertical"),
			h.Role("radiogroup"),
			h.Id(options.id),
			h.AriaOrientation("vertical"),
			...(options.ariaLabel === undefined ? [] : [h.AriaLabel(options.ariaLabel)]),
			...(isDisabled ? [h.AriaDisabled(true), h.DataAttribute("disabled", "true")] : []),
		],
		render(radio),
	)
}
