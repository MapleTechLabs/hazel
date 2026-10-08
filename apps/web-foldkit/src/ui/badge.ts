import type { Html, HtmlBuilder } from "foldkit/html"
import type { VariantProps } from "tailwind-variants"
import { badgeStyles } from "~/components/ui/badge.styles"

/** Port of `components/ui/badge.tsx`. */
export const badge = <Message>(
	h: HtmlBuilder<Message>,
	options: VariantProps<typeof badgeStyles> & { readonly className?: string },
	children: Array<Html | string>,
): Html =>
	h.span(
		[
			h.Class(
				badgeStyles({
					intent: options.intent,
					size: options.size,
					isPill: options.isPill ?? false,
					className: options.className,
				}),
			),
		],
		children,
	)
