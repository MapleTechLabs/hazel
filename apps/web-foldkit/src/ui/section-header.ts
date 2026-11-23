import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { sectionHeaderStyles } from "~/components/ui/section-header.styles"
import { heading } from "./heading"

/** Port of `components/ui/section-header.tsx` (`cn` = twMerge(clsx(...))). */
interface Options<Message> {
	readonly className?: string
	readonly attributes?: ReadonlyArray<Attribute<Message>>
}

type Children = ReadonlyArray<Html | string>

const block =
	(tag: "div" | "p", base: string) =>
	<Message>(h: HtmlBuilder<Message>, options: Options<Message>, children: Children): Html =>
		h[tag]([...(options.attributes ?? []), h.Class(twMerge(base, options.className))], [...children])

export const sectionHeaderRoot = block("div", sectionHeaderStyles.root)
export const sectionHeaderGroup = block("div", sectionHeaderStyles.group)
export const sectionHeaderActions = block("div", sectionHeaderStyles.actions)
export const sectionHeaderSubheading = block("p", sectionHeaderStyles.subheading)

/** `xl` is the `display` heading, `lg` (the default) the `title` one. Prefer `pageHeader`. */
export const sectionHeaderHeading = <Message>(
	h: HtmlBuilder<Message>,
	options: Options<Message> & { readonly size?: "lg" | "xl" },
	children: Children,
): Html =>
	heading(
		h,
		{
			variant: options.size === "xl" ? "display" : "title",
			level: 2,
			className: options.className,
			attributes: options.attributes,
		},
		children,
	)
