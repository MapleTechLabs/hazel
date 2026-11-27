// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The section layouts in the frame (`settings/layout.tsx` and friends): a native sidebar beside the
 * nav rail, and the content column around the route's page, which is a native page or the Foldkit
 * host's page region. A settings page lane only registers its page; the layout stays.
 */
import type { View } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { AccountMenuProps, OrgSwitcherProps } from "@hazel/shared-screens/shell/Chrome"
import { AppRoute, channelSettingsTabOf, hasContentColumn, hrefOf, isChatRoute } from "../route"
import { type CurrentUser, displayNameOf, type Member, type Organization } from "../session"
import { activityGroups, channelSettingsTabsOf, chromeHrefsOf, type SectionLayout } from "../shell/sections"
import { settingsGroups } from "../shell/sections"
import {
	ShellAccountMenu,
	ShellChannelSettingsHeader,
	ShellOrgSwitcher,
	ShellSectionSidebar,
} from "./children"
import { sidebarHeaderHeightClass } from "../platform/desktop"
import { AppMessage } from "./message"
import type { AppModel } from "./logic"
import { Hole } from "./portal"

type H = Html.H<AppMessage>
type Content = View.Content<AppMessage, any>

export interface ChromeData {
	readonly orgSlug: string
	readonly user: CurrentUser
	readonly organization: Organization
	readonly member: Member | null
}

const switcherOf = (model: AppModel, data: ChromeData): OrgSwitcherProps => ({
	organizationId: data.organization.id,
	orgName: data.organization.name,
	logoUrl: data.organization.logoUrl,
	userId: data.user.id,
	hrefs: chromeHrefsOf(data.orgSlug, data.user.id),
	compact: model.isMobile,
	isChat: isChatRoute(model.route) || model.route._tag === "OrgHome",
	canCreateChannel: data.member?.role === "owner" || data.member?.role === "admin",
})

const accountOf = (data: ChromeData): AccountMenuProps => ({
	organizationId: data.organization.id,
	userId: data.user.id,
	name: displayNameOf(data.user),
	email: data.user.email,
	avatarUrl: data.user.avatarUrl,
	hrefs: chromeHrefsOf(data.orgSlug, data.user.id),
})

/**
 * Settings' or Activity's sidebar: docked beside the rail on a wide screen, a sheet on a phone. Null
 * for channel settings, which keeps the chat sidebar (the Foldkit host's, until PH2).
 */
export const sectionSidebar = (h: H, model: AppModel, layout: SectionLayout, data: ChromeData) => {
	if (layout === "channelSettings") return null
	const sidebar = ShellSectionSidebar(h, {
		key: `${layout}:${data.organization.id}`,
		props: {
			kind: layout,
			groups:
				layout === "settings"
					? settingsGroups(data.orgSlug, model.route)
					: activityGroups(data.orgSlug, model.route),
			unreadCount: model.report?.unreadNotificationCount ?? 0,
			isMarkingAllRead: model.report?.isMarkingAllRead ?? false,
			switcher: switcherOf(model, data),
			account: accountOf(data),
			sheet: model.isMobile ? { open: model.isSectionSheetOpen } : null,
		},
		onEmit: { RequestedClose: () => AppMessage.DismissedSectionSheet() },
	})
	if (model.isMobile) return sidebar
	// Docked: today's `sidebarStatic` column (`ui/sidebar.ts`), a fixed header and account card around
	// the rows, which scroll between them.
	return h.div
		.attrs({ "data-slot": "sidebar", "data-intent": "default", "data-collapsible": "none" })
		.class("flex h-full min-w-0 flex-1 flex-col bg-sidebar text-sidebar-fg")
		.children(
			h.div
				.attrs({ "data-slot": "sidebar-header", "data-tauri-drag-region": "true" })
				.class(
					`flex flex-col gap-2 border-b border-sidebar-border p-4 ${layout === "activity" ? "py-4 " : ""}${sidebarHeaderHeightClass()}`,
				)
				.children(
					layout === "settings"
						? ShellOrgSwitcher(h, { key: data.organization.id, props: switcherOf(model, data) })
						: h.span
								.class("text-muted-fg text-xs font-medium uppercase tracking-wider")
								.children("Activity"),
				),
			h.div
				.attr("data-slot", "sidebar-content")
				.class("flex min-h-0 flex-1 flex-col overflow-auto overscroll-none mask-b-from-95%")
				.children(sidebar),
			h.div
				.attr("data-slot", "sidebar-footer")
				.class("mt-auto flex shrink-0 items-center justify-center p-4")
				.children(ShellAccountMenu(h, { key: data.user.id, props: accountOf(data) })),
		)
}

// HAZEL-GAP(p4-section-scroll-column): no primitive scrolls a section's page under the frame with its
// `pt-6 pb-12` rhythm, so the column stays the frame's own markup, as `settings/layout.tsx` draws it.
const scrollColumn = (
	h: H,
	layout: SectionLayout,
	className: string,
	...children: ReadonlyArray<Content>
): Content =>
	h.main
		.class("h-full w-full min-w-0 bg-bg")
		.attr("data-section-layout", layout)
		.children(
			h.div
				.class(`flex h-full min-h-0 w-full flex-col overflow-y-auto pb-12 ${className}`)
				.children(...children),
		)

/** The section's content around `page`: the scroll column, the integrations column, channel settings' header. */
export const sectionContent = (h: H, model: AppModel, layout: SectionLayout, page: Content): Content => {
	const { route } = model
	if (layout !== "channelSettings")
		return scrollColumn(
			h,
			layout,
			"pt-6",
			// The inbox (PA5) sits in the content column too, as its Foldkit page drew its own.
			hasContentColumn(route) || layout === "activity"
				? h.div.class("flex flex-col gap-6 px-4 lg:px-8").children(page)
				: page,
		)
	const tab = channelSettingsTabOf(route) ?? "overview"
	if (!("channelId" in route) || !("orgSlug" in route)) return page
	return scrollColumn(
		h,
		layout,
		"gap-8 pt-8",
		h.div.class("flex flex-col gap-5 px-4 lg:px-8").children(
			ShellChannelSettingsHeader(h, {
				key: route.channelId,
				props: {
					channelId: route.channelId,
					channelHref: hrefOf(
						AppRoute.ChatChannel({ orgSlug: route.orgSlug, channelId: route.channelId }),
					),
					tabs: channelSettingsTabsOf(route),
					selected: tab,
				},
			}),
		),
		page,
	)
}

/** The chrome inside the Foldkit chat and customers sidebars, placed in their holes. */
export const chromeHoles = (h: H, model: AppModel, data: ChromeData) => [
	Hole(h, { hole: "org-switcher", key: data.orgSlug }, [
		ShellOrgSwitcher(h, { key: data.organization.id, props: switcherOf(model, data) }),
	]),
	Hole(h, { hole: "account-menu", key: data.orgSlug, className: "flex w-full" }, [
		ShellAccountMenu(h, { key: data.user.id, props: accountOf(data) }),
	]),
]
