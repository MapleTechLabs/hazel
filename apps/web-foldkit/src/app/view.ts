import type { Html, HtmlBuilder } from "foldkit/html"
import { comboLabel } from "~/lib/keybindings/key-combo"
import * as AiPanel from "../assistant"
import * as Modal from "../overlay/modal"
import * as Toasts from "../overlay/toaster"
import { type PageMessage, viewPage } from "../page/registry"
import { channelLinksOf } from "../page/contract"
import { channelSettingsTabOf, chatChannelIdOf, hasContentColumn, orgSectionOf, orgSlugOf } from "../route"
import { displayNameOf } from "../session"
import * as ChannelsSidebar from "../shell/channels-sidebar"
import * as CustomersSidebar from "../shell/customers-sidebar"
import type { ShellContext } from "../shell/context"
import { channelSettingsLayout, contentColumnLayout, sectionLayout } from "../shell/layouts"
import { formatStatusExpirationAt } from "../shell/menus"
import { mobileSidebarSheet } from "../shell/mobile"
import * as Shell from "../shell/model"
import * as Notifications from "../shell/notifications"
import { notificationsSidebar, settingsSidebar } from "../shell/sidebars"
import type * as Menu from "../ui/menu"
import type * as ModalKit from "../ui/modal"
import { Message } from "./message"
import { aiPanelInputsOf, type Model, sharedOf } from "./model"

/**
 * The host draws its parts into fixed regions; the Effect UI shell moves each region into its
 * place in the frame (`src/root/foldkit.ts`). The list and order never change, so Foldkit only ever
 * patches inside a region and never inserts next to one it no longer holds.
 */
export const REGIONS = ["sidebar", "page", "ai-toggle", "ai-panel", "overlays"] as const
export type Region = (typeof REGIONS)[number]

export const REGION_ATTRIBUTE = "data-foldkit-region"

// Module-level and built as literals: memoized views compare them by reference, and wrapper
// constructors would re-validate large payloads (sidebar rows, message pages) per dispatch.
const toShellMessage = (message: Shell.Message): Message => ({ _tag: "GotShellMessage", message })
const toChannelsSidebarMessage = (message: ChannelsSidebar.Message) =>
	toShellMessage({ _tag: "GotChannelsSidebarMessage", message })
const toCustomersSidebarMessage = (message: CustomersSidebar.Message) =>
	toShellMessage(Shell.Message.GotCustomersSidebarMessage({ message }))
const toUserMenuMessage = (message: Menu.Message) =>
	toShellMessage(Shell.Message.GotUserMenuMessage({ message }))
const toOrgSwitcherMessage = (message: Menu.Message) =>
	toShellMessage(Shell.Message.GotOrgSwitcherMessage({ message }))
const toMobileSidebarMessage = (message: ModalKit.Message) =>
	toShellMessage({ _tag: "GotMobileSidebarMessage", message })
const clickedMarkAllRead = toShellMessage(
	Shell.Message.GotNotificationsMessage({ message: Notifications.Message.ClickedMarkAllRead() }),
)
export const toPageMessage = (message: PageMessage): Message => ({ _tag: "GotPageMessage", message })
const toToastsMessage = (message: Toasts.Message): Message => ({ _tag: "GotToastsMessage", message })
const toModalMessage = (message: Modal.Message): Message => ({ _tag: "GotModalMessage", message })
const toAiPanelMessage = (message: AiPanel.Message): Message => ({ _tag: "GotAiPanelMessage", message })
const pressedAiPanelToggle = toAiPanelMessage(AiPanel.Message.PressedToggle())

/** The org shell's context: the loaded user and organization of the route's slug, or none yet. */
const shellContextOf = (model: Model): ShellContext | null => {
	const { context } = model
	const orgSlug = orgSlugOf(context.route)
	const user = context.currentUser
	const organization = context.organization
	if (orgSlug === undefined || user === null || organization === null) return null
	return {
		orgSlug,
		route: context.route,
		organization,
		currentUser: { displayName: displayNameOf(user), email: user.email, avatarUrl: user.avatarUrl },
		currentUserId: user.id,
		appVersion: __APP_VERSION__,
		paletteKey: sharedOf(model).keys["commandPalette.open"],
		createChannelKey: sharedOf(model).keys["channel.create"],
	}
}

/** The routed page, or an empty placeholder until its page is ported. */
const pageBody = (model: Model, h: HtmlBuilder<Message>, isInsideMain: boolean): Html => {
	if (model.page !== null) return viewPage(h, model.page, { shared: sharedOf(model) }, toPageMessage)
	const placeholder = h.Attribute("data-page-placeholder", model.context.route._tag)
	return isInsideMain ? h.div([placeholder]) : h.main([placeholder])
}

/** The route's section layout around the page (`settings/layout.tsx` and friends). */
const sectionBody = (model: Model, h: HtmlBuilder<Message>): Html => {
	const { route } = model.context
	const section = orgSectionOf(route)
	if (section === "Settings")
		return sectionLayout(
			h,
			hasContentColumn(route)
				? contentColumnLayout(h, pageBody(model, h, true))
				: pageBody(model, h, true),
		)
	if (section === "MySettings" || section === "Notifications")
		return sectionLayout(h, pageBody(model, h, true))
	// Customers pages own their scrolling (the queue's preview panel spans the full height).
	if (section === "Customers")
		return h.main([h.Class("h-full w-full min-w-0 overflow-hidden bg-bg")], [pageBody(model, h, true)])
	const tab = channelSettingsTabOf(route)
	if (tab !== undefined && "channelId" in route)
		return channelSettingsLayout(
			h,
			{
				orgSlug: route.orgSlug,
				channelId: route.channelId,
				channel: model.shell.settingsChannel,
				links: channelLinksOf(sharedOf(model), route.channelId),
				selectedTab: tab,
				onSelectTab: (tabRoute) => h.OnClick(Message.ClickedLayoutTab({ route: tabRoute })),
				onChangeTab: (toRoute) =>
					h.OnChange((value) => Message.ClickedLayoutTab({ route: toRoute(value) })),
			},
			pageBody(model, h, true),
		)
	return pageBody(model, h, false)
}

const secondarySidebar = (model: Model, h: HtmlBuilder<Message>, context: ShellContext): Html => {
	const { shell } = model
	const chrome = {
		userMenu: shell.userMenu,
		orgSwitcher: shell.orgSwitcher,
		userMenuEntries: shell.userMenuEntries,
		orgSwitcherEntries: shell.orgSwitcherEntries,
		organizations: shell.userOrganizations,
		userStatus: shell.userStatus,
		statusExpiration: formatStatusExpirationAt(
			shell.userStatus?.expiresAtMs ?? null,
			model.context.nowMs,
		),
		toUserMenuMessage,
		toOrgSwitcherMessage,
	}
	const section = orgSectionOf(model.context.route)
	if (section === "Settings" || section === "MySettings") return settingsSidebar(h, context, chrome)
	if (section === "Customers")
		return CustomersSidebar.view(h, shell.customersSidebar, context, chrome, toCustomersSidebarMessage)
	if (section === "Notifications")
		return notificationsSidebar(h, context, chrome, {
			unreadCount: Notifications.unreadIdsOf(shell.notifications).length,
			isPending: Notifications.isMarkingAllRead(shell.notifications),
			onPress: h.OnClick(clickedMarkAllRead),
		})
	return ChannelsSidebar.view(
		h,
		shell.channelsSidebar,
		{
			shell: context,
			activeChannelId: chatChannelIdOf(model.context.route),
			nowMs: model.context.nowMs,
			chrome,
		},
		toChannelsSidebarMessage,
	)
}

/**
 * On a phone, the chat list is the Chats tab's page (the channels sidebar, full screen) rather
 * than a sheet behind a menu button: a channel opens from it, and its header leads back.
 */
const phoneChatList = (h: HtmlBuilder<Message>, sidebar: Html): Html =>
	h.main(
		[
			h.Attribute("data-slot", "sidebar"),
			h.Attribute("data-intent", "default"),
			h.Class("flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-fg [--sidebar-width:100%]"),
		],
		[sidebar],
	)

/** The toggle's key, as the user's keyboard labels it ("⌘J"); null when unbound. */
const aiPanelShortcutOf = (model: Model): string | null => {
	const key = sharedOf(model).keys["aiPanel.toggle"]
	return key === null ? null : comboLabel(key, model.context.keyboardPlatform)
}

interface Regions {
	readonly sidebar: ReadonlyArray<Html>
	readonly page: ReadonlyArray<Html>
	readonly "ai-toggle": ReadonlyArray<Html>
	readonly "ai-panel": ReadonlyArray<Html>
	readonly overlays: ReadonlyArray<Html>
}

const regionsOf = (model: Model, h: HtmlBuilder<Message>): Regions => {
	const context = shellContextOf(model)
	const shared = sharedOf(model)
	const overlays = [
		Toasts.view(h, model.toasts, toToastsMessage, model.context.isMobile),
		Modal.view(h, model.modal, shared, toModalMessage),
	]
	if (context === null)
		return { sidebar: [], page: [pageBody(model, h, false)], "ai-toggle": [], "ai-panel": [], overlays }
	const { isMobile } = model.context
	const sidebar = secondarySidebar(model, h, context)
	const isPhoneChatList = isMobile && model.context.route._tag === "ChatIndex"
	return {
		sidebar: isMobile ? [] : [sidebar],
		page: [isPhoneChatList ? phoneChatList(h, sidebar) : sectionBody(model, h)],
		"ai-toggle": [
			AiPanel.toggleButton(h, {
				isOpen: model.aiPanel.isOpen,
				onPress: pressedAiPanelToggle,
				shortcut: aiPanelShortcutOf(model),
			}),
		],
		"ai-panel": [
			h.submodel({
				slotId: "ai-panel",
				model: model.aiPanel,
				view: AiPanel.view,
				viewInputs: { ...aiPanelInputsOf(model), isSidebarCollapsed: model.shell.isSidebarCollapsed },
				toParentMessage: toAiPanelMessage,
			}),
		],
		overlays: isMobile
			? [
					mobileSidebarSheet(h, {
						isOpen: model.shell.isSidebarOpen && !isPhoneChatList,
						children: [sidebar],
						toMessage: toMobileSidebarMessage,
					}),
					...overlays,
				]
			: overlays,
	}
}

export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
	const regions = regionsOf(model, h)
	return h.div(
		[h.Attribute("data-foldkit-host", ""), h.Attribute("hidden", "")],
		REGIONS.map((region) =>
			h.keyed("div")(
				region,
				[h.Attribute(REGION_ATTRIBUTE, region), h.Class("contents")],
				[...regions[region]],
			),
		),
	)
}
