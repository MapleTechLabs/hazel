// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What the Customers settings pages share (today's `page/customers/settings/shared.ts`): who may
 * change settings, the page header, the read-only notice and a card's head. The scroll column
 * around the page is the host's (`native-pages.ts`, until the customers layout draws it).
 */
import type { Hazel } from "@hazel/ui/vocabulary/index"
import type { Session } from "../../../app/session"

type H<Msg> = Hazel.H<Msg>

/** Settings, rules and data sources are for admins and owners; members see them read-only. */
export const isCustomersAdmin = (session: Session): boolean =>
	session.member?.role === "admin" || session.member?.role === "owner"

export interface Crumb<Msg> {
	readonly label: string
	/** Absent: the current page. */
	readonly press?: Msg
}

const children = (items: ReadonlyArray<unknown>) => items.filter((item) => item != null) as Array<never>

/** The page title row: optional breadcrumb, the display title, a subtitle, the actions at its end. */
export const pageHeader = <Msg>(
	h: H<Msg>,
	options: Readonly<{
		title: string
		subtitle?: string
		crumbs?: ReadonlyArray<Crumb<Msg>>
		actions?: ReadonlyArray<unknown>
	}>,
) =>
	h.stack.density("cozy").children(
		...children([
			// HAZEL-GAP(pk8-breadcrumb): today's breadcrumb is one muted 14px line with chevrons; a row of links stands in.
			options.crumbs === undefined
				? null
				: h.stack
						.axis("horizontal")
						.density("snug")
						.align("center")
						.children(
							...options.crumbs
								.flatMap((crumb, index) => [
									index === 0 ? null : h.icon.name("chevron-right"),
									crumb.press === undefined
										? h.text.strong().children(crumb.label)
										: h.link.tone("muted").label(crumb.label).on("press", crumb.press),
								])
								.filter((item) => item !== null),
						),
			h.stack
				.axis("horizontal")
				.wrap()
				.align("start")
				.density("regular")
				.children(
					...children([
						h.stack
							.density("tight")
							.children(
								...children([
									h.heading.level("1").children(options.title),
									options.subtitle === undefined
										? null
										: h.text.role("label").tone("muted").children(options.subtitle),
								]),
							),
						options.actions === undefined || options.actions.length === 0 ? null : h.spacer,
						options.actions === undefined || options.actions.length === 0
							? null
							: h.stack
									.axis("horizontal")
									.density("compact")
									.align("center")
									.children(...children(options.actions)),
					]),
				),
		]),
	)

/** Shown to members on every settings page: they can look, admins change. */
export const readOnlyNotice = <Msg>(h: H<Msg>, what: string) =>
	h.banner.tone("info").description(`Only admins and owners can change ${what}. You can look around.`)

/** The page's column: header, notices and cards, 24px apart. */
export const settingsColumn = <Msg>(h: H<Msg>, key: string, items: ReadonlyArray<unknown>) =>
	h.stack
		.key(key)
		.density("relaxed")
		.children(...children(items))
