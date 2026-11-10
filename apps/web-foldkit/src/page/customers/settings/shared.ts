import type { Html, HtmlBuilder } from "foldkit/html"
import { IconChevronRight } from "../../../icons"
import type { Shared } from "../../contract"

/**
 * What the Customers settings pages (signals, health, sources, unmatched) share: who may change
 * settings, and the page frame (breadcrumb, title, actions, read-only notice).
 */

/** Settings, rules and data sources are for admins and owners; members see them read-only. */
export const isCustomersAdmin = (shared: Shared): boolean =>
	shared.member?.role === "admin" || shared.member?.role === "owner"

export interface Crumb {
	readonly label: string
	/** Absent: the current page. */
	readonly href?: string
}

/** The scrolling page root: settings pages scroll themselves inside the shell's `main`. */
export const settingsPage = <M>(h: HtmlBuilder<M>, children: ReadonlyArray<Html>): Html =>
	h.div(
		[h.Class("h-full overflow-y-auto")],
		[h.div([h.Class("mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 lg:px-8")], [...children])],
	)

const breadcrumb = <M>(h: HtmlBuilder<M>, crumbs: ReadonlyArray<Crumb>): Html =>
	h.nav(
		[h.AriaLabel("Breadcrumb"), h.Class("flex items-center gap-1 text-muted-fg text-sm")],
		crumbs.flatMap((crumb, index) => [
			...(index === 0 ? [] : [IconChevronRight(h, { className: "size-3.5" })]),
			crumb.href === undefined
				? h.span([h.AriaCurrent("page"), h.Class("text-fg")], [crumb.label])
				: h.a([h.Href(crumb.href), h.Class("hover:text-fg")], [crumb.label]),
		]),
	)

/** Title row: optional breadcrumb and leading mark, the title with trailing badges, a subtitle, actions. */
export const settingsHeader = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		title: string
		subtitle?: string | Html
		crumbs?: ReadonlyArray<Crumb>
		leading?: Html
		badges?: ReadonlyArray<Html>
		actions?: ReadonlyArray<Html>
	}>,
): Html =>
	h.header(
		[h.Class("flex flex-col gap-2")],
		[
			...(options.crumbs === undefined ? [] : [breadcrumb(h, options.crumbs)]),
			h.div(
				[h.Class("flex flex-wrap items-start justify-between gap-4")],
				[
					h.div(
						[h.Class("flex min-w-0 items-center gap-3")],
						[
							...(options.leading === undefined ? [] : [options.leading]),
							h.div(
								[h.Class("flex min-w-0 flex-col gap-1")],
								[
									h.div(
										[h.Class("flex flex-wrap items-center gap-2")],
										[
											h.h1([h.Class("font-semibold text-2xl text-fg")], [options.title]),
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

/** Shown to members on every settings page: they can look, admins change. */
export const readOnlyNotice = <M>(h: HtmlBuilder<M>, what: string): Html =>
	h.p(
		[
			h.Role("note"),
			h.Class("rounded-lg border border-border bg-secondary/40 px-3 py-2 text-muted-fg text-sm"),
		],
		[`Only admins and owners can change ${what}. You can look around.`],
	)
