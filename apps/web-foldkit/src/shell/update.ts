import type { OrganizationId, UserId } from "@hazel/schema"
import { Option } from "effect"
import { Command, Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { PageOutMessage } from "../page/out-message"
import { organizationHref } from "../route"
import type { HazelRpc } from "../rpc"
import * as Menu from "../ui/menu"
import * as Modal from "../ui/modal"
import * as ChannelsSidebar from "./channels-sidebar"
import { ORG_SWITCHER_ID, orgSwitcherEntries, USER_MENU_ID, userMenuEntries } from "./menus"
import { MOBILE_SIDEBAR_ID } from "./mobile"
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
}

// INIT

export const init = (): Model => ({
	channelsSidebar: ChannelsSidebar.init(),
	userMenu: Menu.init({ id: USER_MENU_ID, entries: [], placement: "bottom right" }),
	orgSwitcher: Menu.init({ id: ORG_SWITCHER_ID, entries: [] }),
	menuSignature: "",
	userOrganizations: [],
	userStatus: null,
	notifications: Notifications.init(),
	settingsChannel: null,
	isMobile: false,
	isSidebarOpen: false,
})

// UPDATE

export type ShellReturn = Update.ReturnWithOutMessage<Model, Message, PageOutMessage>
/** What `update` returns: the shell's own Commands (mark-read RPCs) need `HazelRpc`. */
export type ShellUpdateReturn = Update.ReturnWithOutMessage<Model, Message, PageOutMessage, HazelRpc>

/** Rebuilds the menus' entries when one of their inputs changed (cheap no-op otherwise). */
const withMenuEntries = (model: Model, context: Context): Model => {
	const { orgSlug, currentUserId } = context
	// The menus only render inside the org shell, which waits for `user.me`.
	if (orgSlug === null) return model
	const signature = JSON.stringify([
		orgSlug,
		context.currentUserId,
		context.isChatSection,
		context.canCreateChannel,
		context.organizationId,
		model.isMobile,
		model.userOrganizations,
	])
	if (signature === model.menuSignature) return model
	return modifyFields(model, {
		menuSignature: () => signature,
		userMenu: (menu) =>
			currentUserId === null
				? menu
				: Menu.reflectEntries(menu, userMenuEntries(orgSlug, currentUserId)),
		orgSwitcher: (menu) =>
			modifyFields(
				Menu.reflectEntries(
					menu,
					orgSwitcherEntries({
						orgSlug,
						isChat: context.isChatSection,
						isMobile: model.isMobile,
						canCreateChannel: context.canCreateChannel,
						organizations: model.userOrganizations,
					}),
				),
				// Mobile shows `SwitchServerMenu` alone: a single-selection list with the current org checked.
				{
					selectionMode: () => (model.isMobile ? "Single" : "None"),
					selectedKeys: () =>
						model.isMobile && context.organizationId !== null
							? [`org:${context.organizationId}`]
							: [],
				},
			),
	})
}

const requested = (model: Model, outMessage: PageOutMessage): ShellReturn => ({ model, outMessage })

const foldUserMenuOutMessage = Menu.OutMessage.match<
	Update.StepWithOutMessage<Model, Message, PageOutMessage>
>({
	SelectedItem:
		({ key }) =>
		(model) =>
			key === "status"
				? requested(model, PageOutMessage.RequestedModal({ modal: { _tag: "SetStatus" } }))
				: key === "feedback"
					? requested(model, PageOutMessage.RequestedModal({ modal: { _tag: "Feedback" } }))
					: key === "logout"
						? requested(model, PageOutMessage.RequestedSignOut())
						: { model },
	ActivatedLink:
		({ href }) =>
		(model) =>
			requested(model, PageOutMessage.RequestedNavigation({ href, replace: false })),
})

const switcherModals: Readonly<Record<string, PageOutMessage>> = {
	"invite-people": PageOutMessage.RequestedModal({ modal: { _tag: "EmailInvite" } }),
	"create-channel": PageOutMessage.RequestedModal({ modal: { _tag: "NewChannel" } }),
	"create-category": PageOutMessage.RequestedModal({ modal: { _tag: "CreateSection" } }),
	"create-server": PageOutMessage.RequestedModal({ modal: { _tag: "CreateOrganization" } }),
}

/**
 * `SwitchServerMenu`: an org without a slug still has to finish setup (`getOrganizationRoute`).
 * Compared with the shown org, since a "Single" menu has already selected the clicked key.
 */
const switchedOrganization = (model: Model, key: string, context: Context): ShellReturn =>
	Option.match(
		Option.fromNullishOr(
			model.userOrganizations.find(
				(organization) =>
					`org:${organization.id}` === key && organization.id !== context.organizationId,
			),
		),
		{
			onNone: () => ({ model }),
			onSome: (organization) =>
				requested(
					model,
					PageOutMessage.RequestedNavigation({
						href: organizationHref(organization),
						replace: false,
					}),
				),
		},
	)

const foldOrgSwitcherOutMessage = (context: Context) =>
	Menu.OutMessage.match<Update.StepWithOutMessage<Model, Message, PageOutMessage>>({
		SelectedItem:
			({ key }) =>
			(model) => {
				const modal = switcherModals[key]
				return modal ? requested(model, modal) : switchedOrganization(model, key, context)
			},
		ActivatedLink:
			({ href }) =>
			(model) =>
				requested(model, PageOutMessage.RequestedNavigation({ href, replace: false })),
	})

const foldUserMenu = Update.foldChild({
	update: Menu.update,
	read: (model: Model) => Option.some(model.userMenu),
	write: (model, userMenu) => modifyFields(model, { userMenu: () => userMenu }),
	toParentMessage: (message) => Message.GotUserMenuMessage({ message }),
	foldOutMessage: foldUserMenuOutMessage,
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
const foldChannelsSidebar = (
	model: Model,
	step: (sidebar: ChannelsSidebar.Model) => ChannelsSidebar.SidebarReturn,
): ShellUpdateReturn => {
	const result = step(model.channelsSidebar)
	return {
		model: modifyFields(model, { channelsSidebar: () => result.model }),
		commands: Command.mapMessages(result.commands ?? [], (message) =>
			Message.GotChannelsSidebarMessage({ message }),
		),
		...(result.outMessage === undefined ? {} : { outMessage: result.outMessage }),
	}
}

export const update = (model: Model, message: Message, context: Context): ShellUpdateReturn => {
	const result = Message.match<ShellUpdateReturn>(message, {
		GotChannelsSidebarMessage: ({ message }) =>
			foldChannelsSidebar(model, (sidebar) => ChannelsSidebar.update(sidebar, message)),
		GotUserMenuMessage: ({ message }) => foldUserMenu(model, message),
		GotOrgSwitcherMessage: ({ message }) => foldOrgSwitcher(context)(model, message),
		UpdatedUserOrganizations: ({ organizations }) => ({
			model: modifyFields(model, { userOrganizations: () => organizations }),
		}),
		UpdatedUserStatus: ({ status }) => ({ model: modifyFields(model, { userStatus: () => status }) }),
		GotNotificationsMessage: ({ message }) => {
			const result = Notifications.update(model.notifications, message)
			return {
				model: modifyFields(model, { notifications: () => result.model }),
				commands: Command.mapMessages(result.commands ?? [], (child) =>
					Message.GotNotificationsMessage({ message: child }),
				),
			}
		},
		UpdatedSettingsChannel: ({ channel }) => ({
			model: modifyFields(model, { settingsChannel: () => channel }),
		}),
		ToggledSidebar: ({ isOpen }) => ({ model: modifyFields(model, { isSidebarOpen: () => isOpen }) }),
		ChangedViewport: ({ isMobile }) => ({ model: modifyFields(model, { isMobile: () => isMobile }) }),
		GotMobileSidebarMessage: ({ message }) => {
			const sheet = Modal.update({ id: MOBILE_SIDEBAR_ID, isOpen: model.isSidebarOpen }, message)
			return {
				model: modifyFields(model, { isSidebarOpen: () => sheet.model.isOpen }),
				commands: Command.mapMessages(sheet.commands ?? [], (child) =>
					Message.GotMobileSidebarMessage({ message: child }),
				),
			}
		},
	})
	return { ...result, model: withMenuEntries(result.model, context) }
}

/** The root learned a new route, organization, user or role. */
export const informContext = (model: Model, context: Context): Update.Return<Model, Message, HazelRpc> => {
	// `setContext` only resets data, so there is no OutMessage to forward.
	const { model: next, commands } = foldChannelsSidebar(withMenuEntries(model, context), (sidebar) =>
		ChannelsSidebar.setContext(sidebar, {
			organizationId: context.organizationId,
			currentUserId: context.currentUserId,
		}),
	)
	return { model: next, commands }
}
