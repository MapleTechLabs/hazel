import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import {
	IconArrowPath,
	IconBell,
	IconChevronRight,
	IconGear,
	IconOffice,
	IconPaintbrush,
	IconUsers,
	IconUsersPlus,
} from "../../icons"
import { AppRoute, hrefOf } from "../../route"
import { avatar } from "../../ui/avatar"
import { heading } from "../../ui/heading"
import { mobileTopBar } from "../../ui/mobile-top-bar"
import { initialsOf, semantic } from "../../ui/semantic"
import type { PageViewInputs } from "../contract"
import type { Message } from "./message"
import type { Model } from "./model"

/**
 * A phone's More tab, as Slack's: who you are at the top, then the workspace's other sections and
 * your own settings, each a row that opens its page. Marked up semantically, so the iOS shell
 * draws it as a native screen.
 */

type Row = Readonly<{
	title: string
	href: string
	/** The SF Symbol the native screen shows; the web draws `icon`. */
	symbol: string
	icon: (className: string) => Html
}>

const ROW_CLASS =
	"flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors duration-100 active:bg-secondary"

const row = (h: HtmlBuilder<Message>, entry: Row): Html =>
	h.keyed("a")(
		entry.href,
		[
			h.Href(entry.href),
			h.Class(ROW_CLASS),
			...semantic(h, {
				kind: "item",
				title: entry.title,
				symbol: entry.symbol,
				trailingSymbol: "chevron.right",
			}),
		],
		[
			h.span(
				[h.Class("flex size-8 shrink-0 items-center justify-center text-muted-fg")],
				[entry.icon("size-5")],
			),
			h.div(
				[h.Class("min-w-0 flex-1")],
				[h.p([h.Class("truncate font-medium text-fg text-sm")], [entry.title])],
			),
			IconChevronRight(h, { className: "size-4 shrink-0 text-muted-fg" }),
		],
	)

const section = (h: HtmlBuilder<Message>, title: string, rows: ReadonlyArray<Row>): Html =>
	h.section(
		[h.Class("pt-4"), ...semantic(h, { kind: "section", title })],
		[
			heading(h, { variant: "label", className: "px-4 pb-1" }, [title]),
			...rows.map((entry) => row(h, entry)),
		],
	)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((_model, { shared }, h) => {
	const orgSlug = shared.orgSlug
	const user = shared.currentUser
	if (orgSlug === null || user === null) return h.empty
	const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email
	const profileHref = hrefOf(AppRoute.MySettingsProfile({ orgSlug }))
	return h.div(
		// The header outside the rows' own scroll, as the chat list's: a native screen pins it and
		// lays out its rows where they sit in their scroll.
		[h.Class("flex h-full flex-col bg-bg"), ...semantic(h, { kind: "screen", title: "More" })],
		[
			mobileTopBar(h, {
				title: "More",
				// The native screen's header: pinned above its scrolling rows.
				attributes: semantic(h, { kind: "item", title: "More", pin: "top" }),
			}),
			h.div(
				[h.Class("min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6")],
				[
					h.section(
						[h.Class("pt-2"), ...semantic(h, { kind: "section", title: "" })],
						[
							h.keyed("a")(
								"profile",
								[
									h.Href(profileHref),
									h.Class(
										"flex items-center gap-3 px-4 py-3 transition-colors duration-100 active:bg-secondary",
									),
									...semantic(h, {
										kind: "item",
										title: name,
										subtitle: user.email,
										avatar: { url: user.avatarUrl ?? null, initials: initialsOf(name) },
										trailingSymbol: "chevron.right",
									}),
								],
								[
									avatar(h, {
										size: "lg",
										src: user.avatarUrl ?? null,
										alt: name,
										seed: name,
										fallbackIcon: true,
									}),
									h.div(
										[h.Class("min-w-0 flex-1")],
										[
											h.p(
												[h.Class("truncate font-semibold text-base text-fg")],
												[name],
											),
											h.p([h.Class("truncate text-muted-fg text-sm")], [user.email]),
										],
									),
									IconChevronRight(h, { className: "size-4 shrink-0 text-muted-fg" }),
								],
							),
						],
					),
					section(h, shared.organization?.name ?? "Workspace", [
						{
							title: "Customers",
							href: hrefOf(AppRoute.CustomersOverview({ orgSlug })),
							symbol: "building.2",
							icon: (className) => IconOffice(h, { className }),
						},
						{
							title: "Members",
							href: hrefOf(AppRoute.OrgHome({ orgSlug })),
							symbol: "person.2",
							icon: (className) => IconUsers(h, { className }),
						},
						{
							title: "Invite people",
							href: hrefOf(AppRoute.SettingsInvitations({ orgSlug })),
							symbol: "person.badge.plus",
							icon: (className) => IconUsersPlus(h, { className }),
						},
						{
							title: "Workspace settings",
							href: hrefOf(AppRoute.SettingsGeneral({ orgSlug })),
							symbol: "gearshape",
							icon: (className) => IconGear(h, { className }),
						},
					]),
					section(h, "You", [
						{
							title: "Notifications",
							href: hrefOf(AppRoute.MySettingsNotifications({ orgSlug })),
							symbol: "bell.badge",
							icon: (className) => IconBell(h, { className }),
						},
						{
							title: "Appearance",
							href: hrefOf(AppRoute.MySettingsAppearance({ orgSlug })),
							symbol: "paintbrush",
							icon: (className) => IconPaintbrush(h, { className }),
						},
						{
							title: "Switch workspace",
							href: hrefOf(AppRoute.SelectOrganization()),
							symbol: "arrow.left.arrow.right",
							icon: (className) => IconArrowPath(h, { className }),
						},
					]),
				],
			),
		],
	)
})
