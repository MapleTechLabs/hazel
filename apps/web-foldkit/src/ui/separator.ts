import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { separatorStyles } from "~/components/ui/separator.styles"

/** Port of `components/ui/separator.tsx` (React Aria Separator renders an `hr` in both orientations). */
export const separator = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly orientation?: "horizontal" | "vertical"; readonly className?: string } = {},
): Html => {
	const orientation = options.orientation ?? "horizontal"
	const className = twMerge(
		separatorStyles.base,
		orientation === "horizontal" ? separatorStyles.horizontal : separatorStyles.vertical,
		options.className,
	)
	return h.hr([h.Class(className), h.Role("separator")])
}
