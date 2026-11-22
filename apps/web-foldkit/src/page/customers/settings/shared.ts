import type { Html, HtmlBuilder } from "foldkit/html"
import { type Crumb, pageHeader } from "../../../customers/ui/surface"
import { IconClose } from "../../../icons"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import type { Shared } from "../../contract"

/**
 * What the Customers settings pages (signals, health, sources, unmatched) share: who may change
 * settings, and the page frame (breadcrumb, title, actions, read-only notice).
 */

/** Settings, rules and data sources are for admins and owners; members see them read-only. */
export const isCustomersAdmin = (shared: Shared): boolean =>
	shared.member?.role === "admin" || shared.member?.role === "owner"

export type { Crumb }

/** The scrolling page root: settings pages scroll themselves inside the shell's `main`. */
export const settingsPage = <M>(h: HtmlBuilder<M>, children: ReadonlyArray<Html>): Html =>
	h.div(
		[h.Class("h-full overflow-y-auto")],
		[h.div([h.Class("mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 lg:px-8")], [...children])],
	)

/** Title row: the Customers `pageHeader` (breadcrumb, leading mark, title and badges, subtitle, actions). */
export const settingsHeader = pageHeader

/** Shown to members on every settings page: they can look, admins change. */
export const readOnlyNotice = <M>(h: HtmlBuilder<M>, what: string): Html =>
	h.p(
		[
			h.Role("note"),
			h.Class("rounded-lg border border-border bg-secondary/40 px-3 py-2 text-muted-fg text-sm"),
		],
		[`Only admins and owners can change ${what}. You can look around.`],
	)

/** A chosen value as a chip, with a remove button for admins. */
export const removableChip = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ label: string; onRemove: M | null }>,
): Html =>
	badge(h, { intent: "secondary", className: "max-w-full gap-1 pe-1" }, [
		h.span([h.Class("truncate")], [options.label]),
		...(options.onRemove === null
			? []
			: [
					button(
						h,
						{
							intent: "plain",
							size: "sq-xs",
							className: "size-5 sm:size-5",
							onPress: options.onRemove,
							attributes: [h.AriaLabel(`Remove ${options.label}`)],
						},
						[IconClose(h, { attributes: { "data-slot": "icon" } })],
					),
				]),
	])
