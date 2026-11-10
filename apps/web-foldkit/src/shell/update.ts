import { OrganizationId, type UserId } from "@hazel/schema"
import { Match, Option, Schema } from "effect"
import { Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { ModalRequest } from "../overlay/modal"
import { PageOutMessage } from "../page/out-message"
import { type AppRoute, organizationRoute } from "../route"
import type { HazelRpc } from "../rpc"
import * as Menu from "../ui/menu"
import * as Modal from "../ui/modal"
import * as ChannelsSidebar from "./channels-sidebar"
import * as CustomersSidebar from "./customers-sidebar"
import {
	decodeSwitcherKey,
	decodeUserMenuKey,
	ORG_SWITCHER_ID,
	orgSwitcherEntries,
	switcherLinkRoute,
	type SwitcherKey,
	USER_MENU_ID,
	userMenuEntries,
	userMenuLinkRoute,
} from "./menus"
import { mobileSidebarModel } from "./mobile"
import * as Notifications from "./notifications"
import { Message, type Model } from "./model"

// CONTEXT

/** Root state the shell's update reads (passed on every dispatch, never stored). */
export interface Context {
	readonly orgSlug: string | null
	readonly isChatSection: boolean
	readonly canCreateChannel: boolean
	readonly organizationId: OrganizationId | null
	readonly currentUserId: UserId | null
	/** `useSidebar().isMobile`: mobile shows a flat org list instead of the full switcher. */
	readonly isMobile: boolean
}

// INIT

export const init = (options: { readonly isCreateChannelHintDismissed: boolean }): Model => ({
	channelsSidebar: ChannelsSidebar.init(options),
	userMenu: Menu.init({ id: USER_MENU_ID, placement: "bottom right" }),
	orgSwitcher: Menu.init({ id: ORG_SWITCHER_ID }),
	userMenuEntries: [],
	orgSwitcherEntries: [],
	userOrganizations: [],
	userStatus: null,
	notifications: Notifications.init(),
	customersSidebar: CustomersSidebar.init(),
	settingsChannel: null,
	isSidebarOpen: false,
	isSidebarCollapsed: false,
})

// UPDATE

export type ShellReturn = Update.ReturnWithOutMessage<Model, Message, PageOutMessage, HazelRpc>
type Step = Update.StepWithOutMessage<Model, Message, PageOutMessage, HazelRpc>

/**
 * The menus' entries from the inputs they show. Rebuilt only where an input changes: the root's
 * context (`informContext`) and the user's organizations.
 */
const withMenuEntries = (model: Model, context: Context): Model => {
	const { orgSlug, currentUserId, isMobile } = context
	// The menus only render inside the org shell, which waits for `user.me`.
	if (orgSlug === null) return model
	return modifyFields(model, {
		userMenuEntries: (entries) =>
			currentUserId === null ? entries : userMenuEntries(orgSlug, currentUserId),
		orgSwitcherEntries: () =>
			orgSwitcherEntries({
				orgSlug,
				isChat: context.isChatSection,
				isMobile,
				canCreateChannel: context.canCreateChannel,
				organizations: model.userOrganizations,
			}),
		orgSwitcher: (menu) =>
			modifyFields(
				menu,
				// Mobile shows `SwitchServerMenu` alone: a single-selection list with the current org checked.
				{
					selectionMode: () => (isMobile ? "Single" : "None"),
					selectedKeys: () =>
						isMobile && context.organizationId !== null ? [context.organizationId] : [],
				},
			),
	})
}

const requested =
	(outMessage: PageOutMessage): Step =>
	(model) => ({ model, outMessage })

const navigateTo = (route: AppRoute): Step =>
	requested(PageOutMessage.RequestedNavigation({ route, replace: false }))

const unchanged: Step = (model) => ({ model })

const foldUserMenuOutMessage = (context: Context) =>
	Menu.OutMessage.match<Step>({
		SelectedItem: ({ key }) =>
			Option.match(decodeUserMenuKey(key), {
				onNone: () => unchanged,
				onSome: (userKey) =>
					Match.value(userKey).pipe(
						Match.withReturnType<Step>(),
						Match.when("status", () =>
							requested(PageOutMessage.RequestedModal({ modal: { _tag: "SetStatus" } })),
						),
						Match.when("feedback", () =>
							requested(PageOutMessage.RequestedModal({ modal: { _tag: "Feedback" } })),
						),
						Match.when("logout", () => requested(PageOutMessage.RequestedSignOut())),
						Match.orElse(() => unchanged),
					),
			}),
		ActivatedLink: ({ key }) =>
			Option.match(
				Option.flatMap(decodeUserMenuKey(key), (userKey) =>
					context.orgSlug === null || context.currentUserId === null
						? Option.none()
						: userMenuLinkRoute(userKey, context.orgSlug, context.currentUserId),
				),
				{ onNone: () => unchanged, onSome: navigateTo },
			),
	})

const switcherModals: { readonly [Key in SwitcherKey]?: ModalRequest } = {
	"invite-people": { _tag: "EmailInvite" },
	"create-channel": { _tag: "NewChannel" },
	"create-category": { _tag: "CreateSection" },
	"create-server": { _tag: "CreateOrganization" },
}

const decodeOrganizationId = Schema.decodeUnknownOption(OrganizationId)

/**
 * `SwitchServerMenu`: an org without a slug still has to finish setup (`getOrganizationRoute`).
 * Compared with the shown org, since a "Single" menu has already selected the clicked key.
 */
const switchedOrganization =
	(organizationId: OrganizationId, context: Context): Step =>
	(model) =>
		Option.match(
			Option.fromNullishOr(
				model.userOrganizations.find(
					(organization) =>
						organization.id === organizationId && organization.id !== context.organizationId,
				),
			),
			{
				onNone: () => ({ model }),
				onSome: (organization) => navigateTo(organizationRoute(organization))(model),
			},
		)

const foldOrgSwitcherOutMessage = (context: Context) =>
	Menu.OutMessage.match<Step>({
		SelectedItem: ({ key }) =>
			Option.match(decodeSwitcherKey(key), {
				onSome: (switcherKey) =>
					Option.match(Option.fromNullishOr(switcherModals[switcherKey]), {
						onNone: () => unchanged,
						onSome: (modal) => requested(PageOutMessage.RequestedModal({ modal })),
					}),
				onNone: () =>
					Option.match(decodeOrganizationId(key), {
						onNone: () => unchanged,
						onSome: (organizationId) => switchedOrganization(organizationId, context),
					}),
			}),
		ActivatedLink: ({ key }) =>
			Option.match(
				Option.flatMap(decodeSwitcherKey(key), (switcherKey) =>
					context.orgSlug === null
						? Option.none()
						: switcherLinkRoute(switcherKey, context.orgSlug),
				),
				{ onNone: () => unchanged, onSome: navigateTo },
			),
	})

const foldUserMenu = (context: Context) =>
	Update.foldChild({
		update: Menu.update,
		read: (model: Model) => Option.some(model.userMenu),
		write: (model, userMenu) => modifyFields(model, { userMenu: () => userMenu }),
		toParentMessage: (message) => Message.GotUserMenuMessage({ message }),
		foldOutMessage: foldUserMenuOutMessage(context),
	})

const foldOrgSwitcher = (context: Context) =>
	Update.foldChild({
		update: Menu.update,
		read: (model: Model) => Option.some(model.orgSwitcher),
		write: (model, orgSwitcher) => modifyFields(model, { orgSwitcher: () => orgSwitcher }),
		toParentMessage: (message) => Message.GotOrgSwitcherMessage({ message }),
		foldOutMessage: foldOrgSwitcherOutMessage(context),
	})

/** The sidebar's Commands, plus its OutMessage (modals, navigation, toasts) for the root. */
const foldChannelsSidebar = Update.foldChild({
	update: ChannelsSidebar.update,
	read: (model: Model) => Option.some(model.channelsSidebar),
	write: (model, channelsSidebar) => modifyFields(model, { channelsSidebar: () => channelsSidebar }),
	toParentMessage: (message) => Message.GotChannelsSidebarMessage({ message }),
	toParentOutMessage: (outMessage: PageOutMessage) => outMessage,
})

const foldNotifications = Update.foldChild({
	update: Notifications.update,
	read: (model: Model) => Option.some(model.notifications),
	write: (model, notifications) => modifyFields(model, { notifications: () => notifications }),
	toParentMessage: (message) => Message.GotNotificationsMessage({ message }),
})

const foldMobileSidebar = Update.foldChild({
	update: Modal.update,
	read: (model: Model) => Option.some(mobileSidebarModel(model.isSidebarOpen)),
	write: (model, sheet) => modifyFields(model, { isSidebarOpen: () => sheet.isOpen }),
	toParentMessage: (message) => Message.GotMobileSidebarMessage({ message }),
	foldOutMessage: Modal.ignoreOutMessage,
})

export const update = (model: Model, message: Message, context: Context): ShellReturn =>
	Message.match<ShellReturn>(message, {
		GotChannelsSidebarMessage: ({ message }) => foldChannelsSidebar(model, message),
		GotUserMenuMessage: ({ message }) => foldUserMenu(context)(model, message),
		GotOrgSwitcherMessage: ({ message }) => foldOrgSwitcher(context)(model, message),
		UpdatedUserOrganizations: ({ organizations }) => ({
			model: withMenuEntries(modifyFields(model, { userOrganizations: () => organizations }), context),
		}),
		UpdatedUserStatus: ({ status }) => ({ model: modifyFields(model, { userStatus: () => status }) }),
		GotNotificationsMessage: ({ message }) => foldNotifications(model, message),
		GotCustomersSidebarMessage: ({ message }) => ({
			model: modifyFields(model, {
				customersSidebar: (sidebar) => CustomersSidebar.update(sidebar, message).model,
			}),
		}),
		UpdatedSettingsChannel: ({ channel }) => ({
			model: modifyFields(model, { settingsChannel: () => channel }),
		}),
		ToggledSidebar: ({ isOpen }) => ({ model: modifyFields(model, { isSidebarOpen: () => isOpen }) }),
		ToggledSidebarCollapsed: () => ({
			model: modifyFields(model, { isSidebarCollapsed: (collapsed) => !collapsed }),
		}),
		GotMobileSidebarMessage: ({ message }) => foldMobileSidebar(model, message),
	})

/** The root learned a new route, organization, user, role or viewport. */
export const informContext = (model: Model, context: Context): Model => {
	const channelsSidebar = ChannelsSidebar.setContext(model.channelsSidebar, {
		organizationId: context.organizationId,
		currentUserId: context.currentUserId,
	})
	return withMenuEntries(
		modifyFields(model, {
			channelsSidebar: () => channelsSidebar,
			customersSidebar: (sidebar) => CustomersSidebar.setOrganization(sidebar, context.organizationId),
		}),
		context,
	)
}
