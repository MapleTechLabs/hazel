import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconChevronRight } from "../../icons"

/**
 * The Customers pages' one visual grammar: page titles, panels, panel headers, labels and text
 * links. Every page builds from these, so a title, a table head or a link reads the same on the
 * overview, a customer and the settings.
 *
 * - Page title: 20px semibold. Panel title: 14px semibold. Body and descriptions: 14px.
 * - Labels (eyebrows, table heads, field names): 12px medium, sentence case, never uppercase.
 * - A panel is a 12px-radius hairline box on the page background; nothing is shadowed.
 */

// TYPE

export const pageTitleClass = "font-semibold text-fg text-xl/7 tracking-tight"
export const titleClass = "font-semibold text-fg text-sm/6"
export const descriptionClass = "text-muted-fg text-sm"
export const labelClass = "font-medium text-muted-fg text-xs"

/** A table's column heads: the label style on a 36px row. */
export const tableHeadClass = "h-9 whitespace-nowrap font-medium text-muted-fg text-xs"

/** An inline text link. */
export const linkClass =
	"rounded-sm font-medium text-primary text-sm outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring/70"

// PANELS

export const panelClass = "rounded-xl border border-border bg-bg"

/** A panel's inner padding. */
export const panelPadClass = "p-4 sm:p-5"

/** A bordered panel with the standard padding and a 16px stack. */
export const panel = <M>(h: HtmlBuilder<M>, className: string, children: ReadonlyArray<Html>): Html =>
	h.section(
		[h.Class(twMerge("flex min-w-0 flex-col gap-4", panelClass, panelPadClass, className))],
		[...children],
	)

/** `Title 12` over a description, with an aside (a link, a toggle) at the right. */
export const panelHeader = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		title: Html | string
		count?: number | string
		description?: Html | string
		aside?: Html
		className?: string
	}>,
): Html =>
	h.header(
		[h.Class(twMerge("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", options.className))],
		[
			// A basis: the title shrinks before the aside wraps under it, and wraps only when narrow.
			h.div(
				[h.Class("flex min-w-0 flex-1 basis-40 flex-col")],
				[
					typeof options.title === "string"
						? h.h2(
								[h.Class(twMerge("flex items-baseline gap-2", titleClass))],
								[
									options.title,
									...(options.count === undefined
										? []
										: [
												h.span(
													[h.Class("font-normal text-muted-fg tabular-nums")],
													[String(options.count)],
												),
											]),
								],
							)
						: options.title,
					...(options.description === undefined
						? []
						: [h.p([h.Class(descriptionClass)], [options.description])]),
				],
			),
			...(options.aside ? [options.aside] : []),
		],
	)

/** A small label over a group: `Properties`, `Provides`, `Webhook URL`. */
export const sectionLabel = <M>(h: HtmlBuilder<M>, label: string, className?: string): Html =>
	h.span([h.Class(twMerge(labelClass, className))], [label])

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

// PAGE HEADER

export interface Crumb<M = never> {
	readonly label: string
	/** Absent: the current page. */
	readonly href?: string
	/** Sent instead of following `href` (a form with unsaved changes asks first). */
	readonly onClick?: M
}

export const breadcrumb = <M>(h: HtmlBuilder<M>, crumbs: ReadonlyArray<Crumb<M>>): Html =>
	h.nav(
		[h.AriaLabel("Breadcrumb"), h.Class("flex min-w-0 items-center gap-1.5 text-muted-fg text-sm")],
		crumbs.flatMap((crumb, index) => [
			...(index === 0 ? [] : [IconChevronRight(h, { className: "size-3 shrink-0" })]),
			crumb.href === undefined
				? h.span([h.AriaCurrent("page"), h.Class("truncate font-medium text-fg")], [crumb.label])
				: h.a(
						[
							h.Href(crumb.href),
							h.Class(
								"rounded-sm outline-hidden hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/70",
							),
							...(crumb.onClick === undefined
								? []
								: [h.OnClick(crumb.onClick, { defaultAction: "Prevent" })]),
						],
						[crumb.label],
					),
		]),
	)

/**
 * A page's title row: optional breadcrumb and leading mark, the title with trailing badges, a
 * subtitle, and the actions at the right (they wrap under the title when the page is narrow).
 */
export const pageHeader = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		title: string
		subtitle?: string | Html
		crumbs?: ReadonlyArray<Crumb<M>>
		leading?: Html
		badges?: ReadonlyArray<Html>
		actions?: ReadonlyArray<Html>
	}>,
): Html =>
	h.header(
		[h.Class("flex flex-col gap-3")],
		[
			...(options.crumbs === undefined ? [] : [breadcrumb(h, options.crumbs)]),
			h.div(
				[h.Class("flex flex-wrap items-start justify-between gap-x-4 gap-y-3")],
				[
					h.div(
						// A basis: a long subtitle wraps before the actions drop under the title.
						[h.Class("flex min-w-0 flex-1 basis-72 items-center gap-3")],
						[
							...(options.leading === undefined ? [] : [options.leading]),
							h.div(
								[h.Class("flex min-w-0 flex-col gap-0.5")],
								[
									h.div(
										[h.Class("flex flex-wrap items-center gap-2")],
										[
											h.h1([h.Class(pageTitleClass)], [options.title]),
											...(options.badges ?? []),
										],
									),
									...(options.subtitle === undefined
										? []
										: [h.p([h.Class(descriptionClass)], [options.subtitle])]),
								],
							),
						],
					),
					...(options.actions === undefined || options.actions.length === 0
						? []
						: [h.div([h.Class("flex flex-wrap items-center gap-2")], [...options.actions])]),
				],
			),
		],
	)

/** `● Synced 1h ago`: a quiet freshness note beside a page's actions. */
export const freshness = <M>(h: HtmlBuilder<M>, label: string): Html =>
	h.span(
		[h.Class("inline-flex items-center gap-1.5 whitespace-nowrap text-muted-fg text-xs")],
		[h.span([h.AriaHidden(true), h.Class("size-1.5 rounded-full bg-success-subtle-fg")]), label],
	)
