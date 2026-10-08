import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
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

/** Options of React Aria's unstyled Button (`ariaButton`). */
export interface AriaButtonOptions<Message> {
	readonly className?: string
	readonly isDisabled?: boolean
	readonly isPending?: boolean
	/** React Aria `excludeFromTabOrder`: `tabindex="-1"`. */
	readonly excludeFromTabOrder?: boolean
	/** React Aria `preventFocusOnPress`: the button never reports focus. */
	readonly preventFocusOnPress?: boolean
	readonly onPress?: Message
	/**
	 * Hover, press and focus-visible state from the page's interaction Submodel. Without it an
	 * enabled button omits `data-rac`, so the shared variants fall back to native `:hover`/`:focus-visible`.
	 */
	readonly interaction?: { readonly wiring: Interaction.Wiring<Message>; readonly target: string }
	readonly attributes?: ReadonlyArray<Attribute<Message> | ChildAttribute>
}

export interface ButtonOptions<Message> extends ButtonVariants, AriaButtonOptions<Message> {}

/** React Aria's Button primitive: `className` is used as is. */
export const ariaButton = <Message>(
	h: HtmlBuilder<Message>,
	options: AriaButtonOptions<Message>,
	children: Array<Html | string>,
): Html => {
	const isDisabled = options.isDisabled ?? false
	const isPending = options.isPending ?? false
	const interaction = options.interaction
	const state = interaction
		? Interaction.stateOf(interaction.wiring.model, interaction.target)
		: Interaction.idleState
	// Child attributes (Mount wiring) carry no event handlers, so pending never strips them.
	const extra = (options.attributes ?? []).filter(
		(attribute) =>
			!isPending ||
			!("_tag" in attribute) ||
			!isEventAttribute(attribute) ||
			preservedWhilePending.test(attribute._tag),
	)
	return h.button(
		[
			...(options.className === undefined ? [] : [h.Class(options.className)]),
			h.Type("button"),
			h.DataAttribute("react-aria-pressable", "true"),
			...(isDisabled
				? [h.Disabled(true), h.DataAttribute("disabled", "true")]
				: [h.Tabindex(options.excludeFromTabOrder ? -1 : 0)]),
			...(isPending ? [h.AriaDisabled(true), h.DataAttribute("pending", "true")] : []),
			...(interaction
				? [
						h.DataAttribute("rac", ""),
						...Interaction.handlers(h, interaction.wiring, interaction.target, {
							isHoverDisabled: isDisabled || isPending,
							isPressDisabled: isDisabled || isPending,
							isFocusDisabled: isDisabled || (options.preventFocusOnPress ?? false),
						}),
						...Interaction.stateAttributes(h, {
							...state,
							isPressed: state.isPressed && !isPending,
						}),
						...Interaction.pressStyleAttributes(h, interaction.wiring.model, interaction.target),
					]
				: // RAC never hovers, presses or focuses a disabled button, unlike native `:hover`.
					isDisabled
					? [h.DataAttribute("rac", "")]
					: []),
			...(options.onPress !== undefined && !isDisabled && !isPending
				? [h.OnClick(options.onPress)]
				: []),
			...extra,
		],
		children,
	)
}

export const button = <Message>(
	h: HtmlBuilder<Message>,
	options: ButtonOptions<Message>,
	children: Array<Html | string>,
): Html =>
	ariaButton(
		h,
		{
			...options,
			// Only the variants reach tv(), as in the legacy call; className is merged afterwards.
			className: buttonClassName(
				{ intent: options.intent, size: options.size, isCircle: options.isCircle },
				options.className,
			),
		},
		children,
	)
