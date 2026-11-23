import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconChevronRight } from "../../icons"
import { link, linkClassName } from "../../ui/link"

/**
 * The Customers pages' text grammar that the kit has no component for: an emphasised line, a
 * description, and text links (on the kit `link`). Headings, panels, page headers and tables come
 * from `src/ui` (`heading`, `panel`/`panelHeader`, `pageHeader`, `dataTable`).
 */

// TYPE

/** An emphasised line that is not a heading (an empty state's headline). */
export const titleClass = "font-semibold text-fg text-sm/6"
export const descriptionClass = "text-muted-fg text-sm"

/** An inline text link: the kit `link`'s classes, in the primary colour (for an element `link` can't render). */
export const linkClass = linkClassName({
	hasHref: true,
	className: "rounded-sm text-primary text-sm hover:underline",
})

// LINKS

/** `View queue ›`: a link out of a panel to the page behind it. */
export const moreLink = <M>(h: HtmlBuilder<M>, href: string, label: string): Html =>
	link(
		h,
		{
			href,
			className: twMerge(linkClass, "inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap"),
		},
		[label, IconChevronRight(h, { className: "size-3.5" })],
	)
