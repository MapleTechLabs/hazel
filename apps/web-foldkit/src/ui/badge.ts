import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import type { VariantProps } from "tailwind-variants"
import { badgeStyles } from "~/components/ui/badge.styles"

/** Port of `components/ui/badge.tsx`. */
export const badge = <Message>(
	h: HtmlBuilder<Message>,
	options: VariantProps<typeof badgeStyles> & {
		readonly className?: string
		/** Extra attributes, e.g. a `title` saying what the badge means. */
		readonly attributes?: ReadonlyArray<Attribute<Message> | ChildAttribute>
	},
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
			...(options.attributes ?? []),
		],
		children,
	)
