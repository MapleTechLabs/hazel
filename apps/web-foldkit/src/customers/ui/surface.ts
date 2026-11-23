import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconChevronRight } from "../../icons"
import { heading } from "../../ui/heading"

/**
 * The Customers pages' one visual grammar: page titles, panels, panel headers, labels and text
 * links. Every page builds from these, so a title, a table head or a link reads the same on the
 * overview, a customer and the settings.
 *
 * - Headings come from the app's `heading` kit: `display` for a page's title, `section` for a
 *   panel's, `subsection` for a group inside a panel or the sidebar. Body and descriptions: 14px.
 * - Labels (table heads, field names, eyebrows): 12px medium, sentence case, never uppercase.
 * - A panel is a 12px-radius hairline box on the page background; nothing is shadowed.
 */

// TYPE

/** An emphasised line that is not a heading (an empty state's headline). */
export const titleClass = "font-semibold text-fg text-sm/6"
export const descriptionClass = "text-muted-fg text-sm"

/** An inline text link. */
export const linkClass =
	"rounded-sm font-medium text-primary text-sm outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring/70"

// LINKS

/** `View queue ›`: a link out of a panel to the page behind it. */
export const moreLink = <M>(h: HtmlBuilder<M>, href: string, label: string): Html =>
	h.a(
		[
			h.Href(href),
			h.Class(twMerge("inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap", linkClass)),
		],
		[label, IconChevronRight(h, { className: "size-3.5" })],
	)
