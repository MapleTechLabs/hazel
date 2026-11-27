import type { Html, HtmlBuilder } from "foldkit/html"
import { callout } from "../../../ui/callout"
import { type Crumb, pageLayout } from "../../../ui/page-header"
import type { Shared } from "../../contract"

/**
 * What the Customers settings pages (signals, sources, unmatched) share: who may change
 * settings, and the page frame (breadcrumb, title, actions, read-only notice).
 */

/** Settings, rules and data sources are for admins and owners; members see them read-only. */
export const isCustomersAdmin = (shared: Shared): boolean =>
	shared.member?.role === "admin" || shared.member?.role === "owner"

/** The scrolling page root: settings pages scroll themselves inside the shell's `main`. */
export const settingsPage = <M>(h: HtmlBuilder<M>, children: ReadonlyArray<Html>): Html =>
	h.div(
		[h.Class("h-full overflow-y-auto")],
		[pageLayout(h, { className: "mx-auto w-full max-w-6xl py-6" }, children)],
	)

/** Shown to members on every settings page: they can look, admins change. */
export const readOnlyNotice = <M>(h: HtmlBuilder<M>, what: string): Html =>
	callout(h, { intent: "info", className: "py-2" }, [
		`Only admins and owners can change ${what}. You can look around.`,
	])
