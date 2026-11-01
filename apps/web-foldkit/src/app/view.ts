import { AsyncData } from "foldkit"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { commonMessage } from "~/lib/error-messages"
import * as CommandPalette from "../overlay/command-palette"
import * as Modal from "../overlay/modal"
import * as Toasts from "../overlay/toaster"
import { type PageMessage, viewPage } from "../page/registry"
import {
	channelSettingsTabOf,
	chatChannelIdOf,
	hasContentColumn,
	isPublicRoute,
	orgSectionOf,
	orgSlugOf,
	titleOf,
} from "../route"
import { type CurrentUser, displayNameOf, type Organization } from "../session"
import { orgShell } from "../shell/app-shell"
import * as ChannelsSidebar from "../shell/channels-sidebar"
import type { ShellContext } from "../shell/context"
import {
	appError,
	appLoader,
	channelSettingsLayout,
	organizationNotFound,
	sectionLayout,
	contentColumnLayout,
} from "../shell/layouts"
import { formatStatusExpirationAt } from "../shell/menus"
import * as Shell from "../shell/model"
import * as Notifications from "../shell/notifications"
import { mySettingsSidebar, notificationsSidebar, settingsSidebar } from "../shell/sidebars"
import type * as Menu from "../ui/menu"
import type * as ModalKit from "../ui/modal"
import { Message } from "./message"
import { type Model, OrgState, Session, sharedOf } from "./model"

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
const toaster = (h: HtmlBuilder<Message>, model: Model): Html => Toasts.view(h, model.toasts, toToastsMessage)
const toModalMessage = (message: Modal.Message): Message => ({ _tag: "GotModalMessage", message })
const toCommandPaletteMessage = (message: CommandPalette.Message): Message => ({
	_tag: "GotCommandPaletteMessage",
	message,
})

/** What the org shell shows: the loaded user and organization of `orgSlug`. */
interface ShellData {
	readonly orgSlug: string
	readonly user: CurrentUser
	readonly organization: Organization
}

const shellContextOf = (model: Model, data: ShellData): ShellContext => ({
	orgSlug: data.orgSlug,
	route: model.route,
	organization: data.organization,
	currentUser: {
		displayName: displayNameOf(data.user),
		email: data.user.email,
		avatarUrl: data.user.avatarUrl,
	},
	appVersion: __APP_VERSION__,
})

/** The routed page, or an empty placeholder until its page is ported. */
const pageBody = (model: Model, h: HtmlBuilder<Message>, isInsideMain: boolean): Html => {
	if (model.page !== null) return viewPage(h, model.page, { shared: sharedOf(model) }, toPageMessage)
	const placeholder = h.Attribute("data-page-placeholder", model.route._tag)
	return isInsideMain ? h.div([placeholder]) : h.main([placeholder])
}

/** The route's section layout around the page (`settings/layout.tsx` and friends). */
const sectionBody = (model: Model, h: HtmlBuilder<Message>): Html => {
	const { route } = model
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
		statusExpiration: formatStatusExpirationAt(shell.userStatus?.expiresAtMs ?? null, model.nowMs),
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
	return ChannelsSidebar.view(
		h,
		shell.channelsSidebar,
		{ shell: context, activeChannelId: chatChannelIdOf(model.route), nowMs: model.nowMs, chrome },
		toChannelsSidebarMessage,
	)
}

/** The app loader; once loading has stalled it also offers a reload. */
const loader = (h: HtmlBuilder<Message>, isStalled: boolean): Html =>
	appLoader(h, isStalled ? Message.PressedReload() : undefined)

const appRoot = (h: HtmlBuilder<Message>, model: Model, children: ReadonlyArray<Html>): Html =>
	h.div([h.Id("app")], [toaster(h, model), ...children])

const orgShellView = (model: Model, h: HtmlBuilder<Message>, data: ShellData): Html => {
	const context = shellContextOf(model, data)
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
			isMobile: model.isMobile,
			isSidebarOpen: model.shell.isSidebarOpen,
			onMenu: h.OnClick(openedMobileSidebar),
			toSheetMessage: toMobileSidebarMessage,
		},
	})
}

/** `$orgSlug/layout.tsx`: a loader while `useOrganization()` loads the route's organization. */
const orgBody = (model: Model, h: HtmlBuilder<Message>, user: CurrentUser): Html => {
	const orgSlug = orgSlugOf(model.route)
	if (orgSlug === undefined) return appRoot(h, model, [pageBody(model, h, false)])
	return OrgState.match(model.org, {
		None: () => appRoot(h, model, [loader(h, false)]),
		Loading: ({ isStalled }) => appRoot(h, model, [loader(h, isStalled)]),
		NotFound: () => appRoot(h, model, [organizationNotFound(h, orgSlug)]),
		Loaded: ({ organization }) => orgShellView(model, h, { orgSlug, user, organization }),
	})
}

const body = (model: Model, h: HtmlBuilder<Message>): Html => {
	const { route } = model
	if (route._tag === "NotFound") return h.div([h.Id("app")], [`Not found: ${route.path}`])
	if (isPublicRoute(route)) return appRoot(h, model, [pageBody(model, h, false)])
	// `_app/layout.tsx`: a loader until the API answers for the session; signed out redirects to sign-in.
	return Session.match(model.session, {
		Loading: () => appRoot(h, model, [loader(h, false)]),
		SignedOut: () => appRoot(h, model, [loader(h, false)]),
		Unreachable: ({ reason }) =>
			appRoot(h, model, [
				appError(h, {
					title: "Can't reach Hazel",
					description: commonMessage(reason).description,
					onRetry: Message.PressedRetrySession(),
				}),
			]),
		// `AppShell`: a loader until `user.me` answers, then the error if it could not.
		SignedIn: ({ user }) =>
			AsyncData.matchData(user, {
				onEmpty: () => appRoot(h, model, [loader(h, false)]),
				onFailure: (reason) =>
					appRoot(h, model, [
						appError(h, {
							title: "Couldn't load your account",
							description: commonMessage(reason).description,
							onRetry: Message.PressedRetryCurrentUser(),
						}),
					]),
				onData: (data) => orgBody(model, h, data),
			}),
	})
}

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
	title: titleOf(model.route),
	body: body(model, h),
})
