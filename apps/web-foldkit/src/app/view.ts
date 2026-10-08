import type { Document, Html, HtmlBuilder } from "foldkit/html"
import * as CommandPalette from "../overlay/command-palette"
import * as Modal from "../overlay/modal"
import * as Toasts from "../overlay/toaster"
import { type PageMessage, viewPage } from "../page/registry"
import { type AppRoute, isPublicRoute, orgSectionOf, orgSlugOf } from "../route"
import { displayNameOf } from "../session"
import { orgShell } from "../shell/app-shell"
import * as ChannelsSidebar from "../shell/channels-sidebar"
import type { ShellContext } from "../shell/context"
import {
	appLoader,
	authLayout,
	type ChannelSettingsTab,
	channelSettingsLayout,
	contentColumnLayout,
	sectionLayout,
} from "../shell/layouts"
import * as Shell from "../shell/model"
import * as Notifications from "../shell/notifications"
import { mySettingsSidebar, notificationsSidebar, settingsSidebar } from "../shell/sidebars"
import type * as Menu from "../ui/menu"
import type * as ModalKit from "../ui/modal"
import { Message } from "./message"
import { type Model, resolvedThemeOf, sharedOf } from "./model"

// Module-level and built as literals: memoized shell views compare them by reference, and
// wrapper constructors would re-validate large payloads (sidebar rows, message pages) per dispatch.
const toShellMessage = (message: Shell.Message): Message => ({ _tag: "GotShellMessage", message })
const toChannelsSidebarMessage = (message: ChannelsSidebar.Message) =>
	toShellMessage({ _tag: "GotChannelsSidebarMessage", message })
const toUserMenuMessage = (message: Menu.Message) =>
	toShellMessage(Shell.Message.GotUserMenuMessage({ message }))
const toOrgSwitcherMessage = (message: Menu.Message) =>
	toShellMessage(Shell.Message.GotOrgSwitcherMessage({ message }))
const toMobileSidebarMessage = (message: ModalKit.Message) =>
	toShellMessage({ _tag: "GotMobileSidebarMessage", message })
const clickedMarkAllRead = toShellMessage(
	Shell.Message.GotNotificationsMessage({ message: Notifications.Message.ClickedMarkAllRead() }),
)
const openedMobileSidebar = toShellMessage(Shell.Message.ToggledSidebar({ isOpen: true }))
export const toPageMessage = (message: PageMessage): Message => ({ _tag: "GotPageMessage", message })
const toToastsMessage = (message: Toasts.Message): Message => ({ _tag: "GotToastsMessage", message })
const toaster = (h: HtmlBuilder<Message>, model: Model): Html =>
	Toasts.view(h, model.toasts, resolvedThemeOf(model), toToastsMessage)
const toModalMessage = (message: Modal.Message): Message => ({ _tag: "GotModalMessage", message })
const toCommandPaletteMessage = (message: CommandPalette.Message): Message => ({
	_tag: "GotCommandPaletteMessage",
	message,
})

const shellContextOf = (model: Model, orgSlug: string): ShellContext => ({
	orgSlug,
	pathname: model.pathname,
	organization: model.organization ?? undefined,
	currentUser: model.currentUser
		? {
				displayName: displayNameOf(model.currentUser),
				email: model.currentUser.email,
				avatarUrl: model.currentUser.avatarUrl,
			}
		: undefined,
	appVersion: __APP_VERSION__,
})

/** The routed page, or an empty placeholder until its page is ported. */
const pageBody = (model: Model, h: HtmlBuilder<Message>, isInsideMain: boolean): Html => {
	if (model.page !== null) return viewPage(h, model.page, { shared: sharedOf(model) }, toPageMessage)
	const placeholder = h.Attribute("data-page-placeholder", model.route._tag)
	return isInsideMain ? h.div([placeholder], []) : h.main([placeholder], [])
}

const channelSettingsTabOf = (route: AppRoute): ChannelSettingsTab | undefined =>
	route._tag === "ChannelSettingsOverview"
		? "overview"
		: route._tag === "ChannelSettingsIntegrations"
			? "integrations"
			: route._tag === "ChannelSettingsConnect"
				? "connect"
				: undefined

const hasContentColumn = (route: AppRoute) =>
	route._tag.startsWith("SettingsIntegration") || route._tag.startsWith("SettingsChatSync")

/** The route's section layout around the page (`settings/layout.tsx` and friends). */
const sectionBody = (model: Model, h: HtmlBuilder<Message>): Html => {
	const route = model.route
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
	const tab = channelSettingsTabOf(route)
	if (tab !== undefined && "channelId" in route)
		return channelSettingsLayout(
			h,
			{
				orgSlug: route.orgSlug,
				channelId: route.channelId,
				channel: model.shell.settingsChannel,
				selectedTab: tab,
				onSelectTab: (href) => h.OnClick(Message.ClickedLayoutTab({ href })),
				onChangeTab: (toHref) => h.OnChange((tab) => Message.ClickedLayoutTab({ href: toHref(tab) })),
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
		organizations: shell.userOrganizations,
		userStatus: shell.userStatus,
		toUserMenuMessage,
		toOrgSwitcherMessage,
	}
	const section = orgSectionOf(model.route)
	if (section === "Settings") return settingsSidebar(h, context, chrome)
	if (section === "MySettings") return mySettingsSidebar(h, context, chrome)
	if (section === "Notifications")
		return notificationsSidebar(h, context, chrome, {
			unreadCount: Notifications.unreadIdsOf(shell.notifications).length,
			isPending: Notifications.isMarkingAllRead(shell.notifications),
			onPress: h.OnClick(clickedMarkAllRead),
		})
	const route = model.route
	return ChannelsSidebar.view(
		h,
		shell.channelsSidebar,
		{
			shell: context,
			activeChannelId:
				route._tag.startsWith("Chat") && "channelId" in route ? route.channelId : undefined,
			chrome,
		},
		toChannelsSidebarMessage,
	)
}

const appRoot = (h: HtmlBuilder<Message>, model: Model, children: ReadonlyArray<Html>): Html =>
	h.div([h.Id("app")], [toaster(h, model), ...children])

const body = (model: Model, h: HtmlBuilder<Message>): Html => {
	const route = model.route
	if (route._tag === "NotFound") return h.div([h.Id("app")], [`Not found: ${route.path}`])
	if (route._tag === "SignIn" || route._tag === "SignUp")
		return appRoot(h, model, [authLayout(h, pageBody(model, h, true))])
	if (isPublicRoute(route)) return appRoot(h, model, [pageBody(model, h, false)])
	// `_app/layout.tsx`: a loader until Clerk knows the session; signed out redirects to sign-in.
	if (model.auth !== "SignedIn") return appRoot(h, model, [appLoader(h)])
	// `AppShell`: a loader until `user.me` answers.
	if (model.currentUser === null) return appRoot(h, model, [appLoader(h)])
	const orgSlug = orgSlugOf(route)
	if (orgSlug === undefined) return appRoot(h, model, [pageBody(model, h, false)])
	// `$orgSlug/layout.tsx`: a loader while `useOrganization()` loads the route's organization.
	if (model.loadedOrgSlug !== orgSlug) return appRoot(h, model, [appLoader(h)])
	const context = shellContextOf(model, orgSlug)
	return orgShell(h, context, {
		page: sectionBody(model, h),
		secondarySidebar: secondarySidebar(model, h, context),
		// The bell reads `useUnreadNotificationCount`, which has no optimistic layer.
		unreadNotificationCount: model.shell.notifications.unreadIds.length,
		toaster: toaster(h, model),
		overlays: [
			Modal.view(h, model.modal, sharedOf(model), toModalMessage),
			h.submodel({
				slotId: "command-palette",
				model: model.commandPalette,
				view: CommandPalette.view,
				viewInputs: { shared: sharedOf(model) },
				toParentMessage: toCommandPaletteMessage,
			}),
		],
		mobile: {
			isMobile: model.shell.isMobile,
			isSidebarOpen: model.shell.isSidebarOpen,
			onMenu: h.OnClick(openedMobileSidebar),
			toSheetMessage: toMobileSidebarMessage,
		},
	})
}

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
	title: "Hazel Chat",
	body: body(model, h),
})
