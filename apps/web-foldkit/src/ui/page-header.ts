import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconChevronRight } from "../icons"
import { heading } from "./heading"

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
 * The one page title row; every page and settings tab opens with it. An optional breadcrumb and
 * leading mark, the title with trailing badges, a subtitle, and the actions at the right (they wrap
 * under the title when the page is narrow).
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
		/** `display` (24px) for a top-level page, the default; `title` (18px) for a settings tab. */
		size?: "display" | "title"
		className?: string
	}>,
): Html =>
	h.header(
		[h.Class(twMerge("flex flex-col gap-3", options.className))],
		[
			...(options.crumbs === undefined ? [] : [breadcrumb(h, options.crumbs)]),
			h.div(
				[h.Class("flex flex-wrap items-start justify-between gap-x-4 gap-y-3")],
				[
					h.div(
						// A basis: a long subtitle wraps before the actions drop under the title. Top-aligned, so
						// the mark stays by the title when it does.
						[h.Class("flex min-w-0 flex-1 basis-72 items-start gap-3")],
						[
							...(options.leading === undefined ? [] : [options.leading]),
							h.div(
								[h.Class("flex min-w-0 flex-col gap-0.5")],
								[
									h.div(
										[h.Class("flex flex-wrap items-center gap-2")],
										[
											heading(h, { variant: options.size ?? "display" }, [
												options.title,
											]),
											...(options.badges ?? []),
										],
									),
									...(options.subtitle === undefined
										? []
										: [h.p([h.Class("text-muted-fg text-sm")], [options.subtitle])]),
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

/**
 * A page's column: the header, then its sections, 24px apart, with the app's side gutter. Every
 * settings page, tab and top-level list sits in one; don't restate `flex flex-col gap-6 px-4 lg:px-8`.
 */
export const pageLayout = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ className?: string }>,
	children: ReadonlyArray<Html>,
): Html => h.div([h.Class(twMerge("flex flex-col gap-6 px-4 lg:px-8", options.className))], [...children])
