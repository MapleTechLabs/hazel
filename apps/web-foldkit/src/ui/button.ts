import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import type { VariantProps } from "tailwind-variants"
import { twMerge } from "tailwind-merge"
import { buttonStyles } from "~/components/ui/button.styles"
import * as Interaction from "./aria/interaction"

/** Port of `components/ui/button.tsx` (React Aria Button). */
export type ButtonVariants = VariantProps<typeof buttonStyles>

export const buttonClassName = (variants: ButtonVariants, className?: string) =>
	// Legacy `cx` (lib/primitive) = twMerge(twMerge(...base), className) through React Aria render props.
	twMerge(twMerge(buttonStyles(variants)), className)

/** React Aria keeps these handlers on a pending button (Button.tsx PRESERVED_EVENT_PATTERN). */
const preservedWhilePending = /Focus|Blur|Hover|Pointer(Enter|Leave|Over|Out)|Mouse(Enter|Leave|Over|Out)/
const isEventAttribute = (attribute: { readonly _tag: string }) => attribute._tag.startsWith("On")

export interface ButtonOptions<Message> extends ButtonVariants {
	readonly className?: string
	readonly isDisabled?: boolean
	readonly isPending?: boolean
	readonly onPress?: Message
	/**
	 * Hover, press and focus-visible state from the page's interaction Submodel. Without it the
	 * button omits `data-rac`, so the shared variants fall back to native `:hover`/`:focus-visible`.
	 */
	readonly interaction?: { readonly wiring: Interaction.Wiring<Message>; readonly target: string }
	readonly attributes?: ReadonlyArray<Attribute<Message>>
}

export const button = <Message>(
	h: HtmlBuilder<Message>,
	options: ButtonOptions<Message>,
	children: Array<Html | string>,
): Html => {
	const isDisabled = options.isDisabled ?? false
	const isPending = options.isPending ?? false
	const interaction = options.interaction
	const state = interaction
		? Interaction.stateOf(interaction.wiring.model, interaction.target)
		: Interaction.idleState
	const extra = (options.attributes ?? []).filter(
		(attribute) =>
			!isPending || !isEventAttribute(attribute) || preservedWhilePending.test(attribute._tag),
	)
	return h.button(
		[
			h.Class(buttonClassName(options, options.className)),
			h.Type("button"),
			h.DataAttribute("react-aria-pressable", "true"),
			...(isDisabled ? [h.Disabled(true), h.DataAttribute("disabled", "true")] : [h.Tabindex(0)]),
			...(isPending ? [h.AriaDisabled(true), h.DataAttribute("pending", "true")] : []),
			...(interaction
				? [
						h.DataAttribute("rac", ""),
						...Interaction.handlers(h, interaction.wiring, interaction.target, {
							isHoverDisabled: isDisabled || isPending,
							isPressDisabled: isDisabled || isPending,
							isFocusDisabled: isDisabled,
						}),
						...Interaction.stateAttributes(h, {
							...state,
							isPressed: state.isPressed && !isPending,
						}),
						...Interaction.pressStyleAttributes(h, interaction.wiring.model, interaction.target),
					]
				: []),
			...(options.onPress !== undefined && !isDisabled && !isPending
				? [h.OnClick(options.onPress)]
				: []),
			...extra,
		],
		children,
	)
}
