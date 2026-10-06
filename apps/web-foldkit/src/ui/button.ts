import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import type { VariantProps } from "tailwind-variants"
import { twMerge } from "tailwind-merge"
import { buttonStyles } from "~/components/ui/button.styles"

/** Port of `components/ui/button.tsx` (React Aria Button). */
export type ButtonVariants = VariantProps<typeof buttonStyles>

export const buttonClassName = (variants: ButtonVariants, className?: string) =>
	// Legacy `cx` (lib/primitive) = twMerge(twMerge(...base), className) through React Aria render props.
	twMerge(twMerge(buttonStyles(variants)), className)

export const button = <Message>(
	h: HtmlBuilder<Message>,
	options: ButtonVariants & {
		readonly className?: string
		readonly attributes?: ReadonlyArray<Attribute<Message>>
	},
	children: Array<Html | string>,
): Html =>
	h.button(
		[
			h.Class(buttonClassName(options, options.className)),
			h.Attribute("type", "button"),
			h.Attribute("tabindex", "0"),
			h.Attribute("data-react-aria-pressable", "true"),
			...(options.attributes ?? []),
		],
		children,
	)
