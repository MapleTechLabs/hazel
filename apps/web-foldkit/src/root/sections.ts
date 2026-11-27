// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The section layouts in the frame (`settings/layout.tsx` and friends): a native sidebar beside the
 * nav rail (the channel list, customers, settings, activity), a sheet on a phone, and the content
 * column around the route's page, which is a native page or the Foldkit host's page region. A
 * section's page lane only registers its page in `native-pages.ts`; the layout stays.
 */
import type { View } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { ChannelSidebarProps } from "@hazel/shared-screens/channel-sidebar/ChannelSidebar"
import type { AccountMenuProps, OrgSwitcherProps } from "@hazel/shared-screens/shell/Chrome"
import { comboLabel } from "~/lib/keybindings/key-combo"
import {
	AppRoute,
	channelSettingsTabOf,
	chatChannelIdOf,
	customersListRoute,
	hasContentColumn,
	hrefOf,
	isChatRoute,
} from "../route"
import { type CurrentUser, displayNameOf, type Member, type Organization } from "../session"
import {
	activityGroups,
	channelSettingsTabsOf,
	chromeHrefsOf,
	customersPages,
	customersSettings,
	customersViewOf,
	type DockSidebar,
	dockSidebarOf,
	type SectionLayout,
	settingsGroups,
} from "../shell/sections"
import {
	ShellAccountMenu,
	ShellChannelSettingsHeader,
	ShellChannelSidebar,
	ShellChatSidebarSheet,
	ShellCustomersSidebar,
	ShellOrgSwitcher,
	ShellSectionSidebar,
} from "./children"
import { isDismissedNow } from "./hints"
import { sidebarHeaderHeightClass } from "../platform/desktop"
import { AppMessage } from "./message"
import { type AppModel, keysOf } from "./logic"

type H = Html.H<AppMessage>
type Content = View.Content<AppMessage, any>

export interface ChromeData {
	readonly orgSlug: string
	readonly user: CurrentUser
	readonly organization: Organization
	readonly member: Member | null
	/** The create-channel hint was dismissed before this load (`entry.ts`). */
	readonly isHintDismissedAtBoot: boolean
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

/** Whose channel list this is: a switch of org or user mounts a fresh one. */
export const channelListKeyOf = (data: ChromeData) => `${data.organization.id}:${data.user.id}`

const channelSidebarPropsOf = (model: AppModel, data: ChromeData): ChannelSidebarProps => {
	const paletteKey = keysOf(model)["commandPalette.open"]
	return {
		organizationId: data.organization.id,
		userId: data.user.id,
		orgSlug: data.orgSlug,
		activeChannelId: chatChannelIdOf(model.route),
		membersActive: model.route._tag === "OrgHome",
		hintDismissed: data.isHintDismissedAtBoot || isDismissedNow("create-channel"),
		paletteKey: paletteKey === null ? null : comboLabel(paletteKey, model.keyboardPlatform),
		chrome: false,
	}
}

const channelSidebar = (h: H, model: AppModel, data: ChromeData) => {
	const key = channelListKeyOf(data)
	return ShellChannelSidebar(h, {
		key,
		props: channelSidebarPropsOf(model, data),
		onEmit: { Loaded: () => AppMessage.LoadedChannelList({ key }) },
	})
}

const customersSidebar = (
	h: H,
	model: AppModel,
	data: ChromeData,
	sheet: { readonly open: boolean } | null,
) =>
	ShellCustomersSidebar(h, {
		key: `customers:${channelListKeyOf(data)}`,
		props: {
			organizationId: data.organization.id,
			userId: data.user.id,
			pages: customersPages(data.orgSlug, model.route),
			settings: customersSettings(data.orgSlug, model.route),
			listHref: hrefOf(customersListRoute(data.orgSlug)),
			currentView: customersViewOf(model.route),
			account: accountOf(data),
			sheet,
		},
		onEmit: { RequestedClose: () => AppMessage.DismissedSectionSheet() },
	})

const sectionSidebarOf = (h: H, model: AppModel, layout: "settings" | "activity", data: ChromeData) =>
	ShellSectionSidebar(h, {
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

/**
 * Today's `sidebarStatic` column (`ui/sidebar.ts`): a fixed header and account card around the rows,
 * which scroll between them. `waiting` keeps the last screen's paint up (`app/paint.ts`).
 */
const column = (
	h: H,
	options: {
		readonly header: Content
		readonly headerClass: string
		readonly waiting: boolean
		/** The chat and customers cards sat in a full-width hole; settings' sits in the footer itself. */
		readonly wrapAccount: boolean
	},
	body: Content,
	data: ChromeData,
	className = "flex h-full min-w-0 flex-1 flex-col bg-sidebar text-sidebar-fg",
) =>
	h.div
		.attrs({ "data-slot": "sidebar", "data-intent": "default", "data-collapsible": "none" })
		.class(className)
		.children(
			options.waiting ? h.div.key("waiting").attrs({ "data-paint": "loading", hidden: "" }) : null,
			h.div
				.key("header")
				.attrs({ "data-slot": "sidebar-header", "data-tauri-drag-region": "true" })
				.class(
					`flex flex-col gap-2 border-b border-sidebar-border p-4 ${options.headerClass}${sidebarHeaderHeightClass()}`,
				)
				.children(options.header),
			h.div
				.key("content")
				.attr("data-slot", "sidebar-content")
				.class("flex min-h-0 flex-1 flex-col overflow-auto overscroll-none mask-b-from-95%")
				.children(body),
			h.div
				.key("footer")
				.attr("data-slot", "sidebar-footer")
				.class("mt-auto flex shrink-0 items-center justify-center p-4")
				.children(
					options.wrapAccount
						? h.div
								.class("flex w-full min-w-0")
								.children(ShellAccountMenu(h, { key: data.user.id, props: accountOf(data) }))
						: ShellAccountMenu(h, { key: data.user.id, props: accountOf(data) }),
				),
		)

const sectionLabel = (h: H, label: string) =>
	h.span.class("text-muted-fg text-xs font-medium uppercase tracking-wider").children(label)

/** The channel list's column: the org switcher over the list over the account card. */
const chatColumn = (h: H, model: AppModel, data: ChromeData, className?: string) =>
	column(
		h,
		{
			header: ShellOrgSwitcher(h, { key: data.organization.id, props: switcherOf(model, data) }),
			headerClass: "",
			waiting: model.channelListLoaded !== channelListKeyOf(data),
			wrapAccount: true,
		},
		channelSidebar(h, model, data),
		data,
		className,
	)

/** The dock's sidebar for the route, beside the rail on a wide screen. */
export const dockSidebar = (h: H, model: AppModel, data: ChromeData): Content | null => {
	const dock = dockSidebarOf(model.route)
	if (dock === null) return null
	return dockColumns[dock](h, model, data)
}

const dockColumns = {
	chat: (h, model, data) => chatColumn(h, model, data),
	customers: (h, model, data) =>
		column(
			h,
			{ header: sectionLabel(h, "Customers"), headerClass: "py-4 ", waiting: false, wrapAccount: true },
			customersSidebar(h, model, data, null),
			data,
		),
	settings: (h, model, data) =>
		column(
			h,
			{
				header: ShellOrgSwitcher(h, { key: data.organization.id, props: switcherOf(model, data) }),
				headerClass: "",
				waiting: false,
				wrapAccount: false,
			},
			sectionSidebarOf(h, model, "settings", data),
			data,
		),
	activity: (h, model, data) =>
		column(
			h,
			{ header: sectionLabel(h, "Activity"), headerClass: "py-4 ", waiting: false, wrapAccount: false },
			sectionSidebarOf(h, model, "activity", data),
			data,
		),
} satisfies { readonly [D in DockSidebar]: (h: H, model: AppModel, data: ChromeData) => Content }

/** The phone's chat list (the Chats tab's page): the channel list's column, full screen. */
export const phoneChatList = (h: H, model: AppModel, data: ChromeData): Content =>
	h.main
		.class("contents")
		.children(
			chatColumn(
				h,
				model,
				data,
				"flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-fg [--sidebar-width:100%]",
			),
		)

export const isPhoneChatList = (model: AppModel) => model.isMobile && model.route._tag === "ChatIndex"

/** A phone's sidebar sheet, opened from its top bar (none over the chat list, which is the sidebar). */
export const phoneSheet = (h: H, model: AppModel, data: ChromeData): Content | null => {
	const dock = dockSidebarOf(model.route)
	if (dock === null || isPhoneChatList(model)) return null
	if (dock === "settings" || dock === "activity") return sectionSidebarOf(h, model, dock, data)
	if (dock === "customers") return customersSidebar(h, model, data, { open: model.isSectionSheetOpen })
	return ShellChatSidebarSheet(h, {
		key: channelListKeyOf(data),
		props: {
			open: model.isSectionSheetOpen,
			sidebar: channelSidebarPropsOf(model, data),
			switcher: switcherOf(model, data),
			account: accountOf(data),
		},
		onEmit: { RequestedClose: () => AppMessage.DismissedSectionSheet() },
	})
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

/**
 * The section's content around `page`: the scroll column, the integrations column, channel settings'
 * header, or customers' full-height column (its pages own their scrolling: the queue's preview spans it).
 */
export const sectionContent = (h: H, model: AppModel, layout: SectionLayout, page: Content): Content => {
	const { route } = model
	if (layout === "customers")
		return h.main
			.class("h-full w-full min-w-0 overflow-hidden bg-bg")
			.attr("data-section-layout", layout)
			.children(page)
	if (layout !== "channelSettings")
		return scrollColumn(
			h,
			layout,
			"pt-6",
			hasContentColumn(route) ? h.div.class("flex flex-col gap-6 px-4 lg:px-8").children(page) : page,
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
