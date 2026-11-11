import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { sectionHeaderStyles } from "~/components/ui/section-header.styles"

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

export const sectionHeaderHeading = <Message>(
	h: HtmlBuilder<Message>,
	options: Options<Message> & { readonly size?: "lg" | "xl" },
	children: Children,
): Html =>
	h.h2(
		[
			...(options.attributes ?? []),
			h.Class(
				twMerge(
					sectionHeaderStyles.heading,
					options.size === "xl" ? sectionHeaderStyles.headingXl : sectionHeaderStyles.headingLg,
					options.className,
				),
			),
		],
		[...children],
	)
