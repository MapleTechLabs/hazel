import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { linkStyles } from "~/components/ui/link.styles"
import * as Interaction from "./aria/interaction"

/** Port of `components/ui/link.tsx` class composition (React Aria Link + `cx`). */
export const linkClassName = (options: { readonly hasHref: boolean; readonly className?: string }) =>
	twMerge(twMerge(linkStyles(options)), options.className)

export interface LinkOptions<Message> {
	readonly href?: string
	readonly className?: string
	readonly isDisabled?: boolean
	readonly onPress?: Message
	readonly interaction?: { readonly wiring: Interaction.Wiring<Message>; readonly target: string }
	readonly attributes?: ReadonlyArray<Attribute<Message>>
}

/** React Aria renders an `<a>` when there is an enabled href, otherwise a `<span role="link">`. */
export const link = <Message>(
	h: HtmlBuilder<Message>,
	options: LinkOptions<Message>,
	children: Array<Html | string>,
): Html => {
	const isDisabled = options.isDisabled ?? false
	const isAnchor = options.href !== undefined && !isDisabled
	const interaction = options.interaction
	const attributes = [
		h.Class(linkClassName({ hasHref: options.href !== undefined, className: options.className })),
		h.DataAttribute("react-aria-pressable", "true"),
		// A disabled link still carries its href attribute, on the span.
		...(options.href !== undefined ? [h.Attribute("href", options.href)] : []),
		...(isAnchor ? [] : [h.Role("link")]),
		...(isDisabled ? [] : [h.Tabindex(0)]),
		...(isDisabled ? [h.AriaDisabled(true), h.DataAttribute("disabled", "true")] : []),
		...(interaction
			? [
					h.DataAttribute("rac", ""),
					...Interaction.handlers(h, interaction.wiring, interaction.target, {
						isHoverDisabled: isDisabled,
						isPressDisabled: isDisabled,
						isFocusDisabled: isDisabled,
					}),
					...Interaction.stateAttributes(
						h,
						Interaction.stateOf(interaction.wiring.model, interaction.target),
					),
					...Interaction.pressStyleAttributes(h, interaction.wiring.model, interaction.target),
				]
			: []),
		...(options.onPress !== undefined && !isDisabled ? [h.OnClick(options.onPress)] : []),
		...(options.attributes ?? []),
	]
	return isAnchor ? h.a(attributes, children) : h.span(attributes, children)
}
