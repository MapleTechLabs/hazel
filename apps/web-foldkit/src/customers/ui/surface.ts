import { linkClassName } from "../../ui/link"

/**
 * The Customers pages' text grammar that the kit has no component for: an emphasised line, a
 * description, and text links (on the kit `link`). Headings, panels, page headers and tables come
 * from `src/ui` (`heading`, `panel`/`panelHeader`, `pageHeader`, `dataTable`).
 */

// TYPE

/** An inline text link: the kit `link`'s classes, in the primary colour (for an element `link` can't render). */
export const linkClass = linkClassName({
	hasHref: true,
	className: "rounded-sm text-primary text-sm hover:underline",
})
