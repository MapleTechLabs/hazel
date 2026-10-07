import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import type { VariantProps } from "tailwind-variants"
import { toggleStyles } from "~/components/ui/toggle.styles"
import * as Interaction from "./aria/interaction"

/**
 * Port of `components/ui/toggle.tsx` (React Aria ToggleButton). Selection lives in the parent's
 * Model; hover, press and focus-visible come from the page's interaction Submodel.
 */

export type ToggleVariants = Omit<VariantProps<typeof toggleStyles>, "isDisabled">

export interface ToggleOptions<Message> extends ToggleVariants {
	readonly isSelected: boolean
	readonly onPress: Message
	readonly interaction: { readonly wiring: Interaction.Wiring<Message>; readonly target: string }
	readonly isDisabled?: boolean
	readonly className?: string
	readonly ariaLabel?: string
}

const flag = <Message>(h: HtmlBuilder<Message>, name: string, isOn: boolean) =>
	isOn ? [h.DataAttribute(name, "true")] : []

export const toggle = <Message>(
	h: HtmlBuilder<Message>,
	options: ToggleOptions<Message>,
	content: ReadonlyArray<Html | string>,
): Html => {
	const isDisabled = options.isDisabled === true
	const { wiring, target } = options.interaction
	const state = isDisabled ? Interaction.idleState : Interaction.stateOf(wiring.model, target)
	// React Aria's render props, spread whole into tv() as the legacy component does.
	const renderProps = { ...state, isSelected: options.isSelected, isDisabled }
	const handlers: ReadonlyArray<Attribute<Message>> = isDisabled
		? [h.Disabled(true)]
		: [
				h.Tabindex(0),
				...Interaction.handlers(h, wiring, target),
				...Interaction.pressStyleAttributes(h, wiring.model, target),
				h.OnClick(options.onPress),
			]
	return h.button(
		[
			h.Class(
				twMerge(
					toggleStyles({
						...renderProps,
						isCircle: options.isCircle,
						size: options.size,
						intent: options.intent,
						className: options.className,
					}),
				),
			),
			h.Type("button"),
			h.AriaPressed(options.isSelected ? "true" : "false"),
			...(options.ariaLabel === undefined ? [] : [h.AriaLabel(options.ariaLabel)]),
			h.Attribute("data-rac", ""),
			h.Attribute("data-react-aria-pressable", "true"),
			...Interaction.stateAttributes(h, state),
			...flag(h, "selected", options.isSelected),
			...flag(h, "disabled", isDisabled),
			...handlers,
		],
		[...content],
	)
}
