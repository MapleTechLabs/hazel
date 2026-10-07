import type { OrganizationId, UserId } from "@hazel/schema"
import { Option } from "effect"
import { Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { PageOutMessage } from "../page/out-message"
import * as Menu from "../ui/menu"
import * as ChannelsSidebar from "./channels-sidebar"
import { ORG_SWITCHER_ID, orgSwitcherEntries, USER_MENU_ID, userMenuEntries } from "./menus"
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
	unreadNotificationCount: 0,
	settingsChannel: null,
	isSidebarOpen: false,
	collapsedSectionIds: [],
	panelWidths: {},
})

// UPDATE

export type ShellReturn = Update.ReturnWithOutMessage<Model, Message, PageOutMessage>

/** Rebuilds the menus' entries when one of their inputs changed (cheap no-op otherwise). */
const withMenuEntries = (model: Model, context: Context): Model => {
	const orgSlug = context.orgSlug ?? ""
	const signature = JSON.stringify([
		orgSlug,
		context.currentUserId,
		context.isChatSection,
		context.canCreateChannel,
		model.userOrganizations,
	])
	if (signature === model.menuSignature) return model
	return modifyFields(model, {
		menuSignature: () => signature,
		userMenu: (menu) => Menu.reflectEntries(menu, userMenuEntries(orgSlug, context.currentUserId ?? "")),
		orgSwitcher: (menu) =>
			Menu.reflectEntries(
				menu,
				orgSwitcherEntries({
					orgSlug,
					isChat: context.isChatSection,
					canCreateChannel: context.canCreateChannel,
					organizations: model.userOrganizations,
				}),
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

/** `SwitchServerMenu`: an org without a slug still has to finish setup (`getOrganizationRoute`). */
const switchedOrganization = (model: Model, key: string): ShellReturn =>
	Option.match(
		Option.fromNullishOr(
			model.userOrganizations.find((organization) => `org:${organization.id}` === key),
		),
		{
			onNone: () => ({ model }),
			onSome: (organization) =>
				requested(
					model,
					PageOutMessage.RequestedNavigation({
						href: organization.slug
							? `/${organization.slug}`
							: `/onboarding/setup-organization?${new URLSearchParams({ orgId: organization.id })}`,
						replace: false,
					}),
				),
		},
	)

const foldOrgSwitcherOutMessage = Menu.OutMessage.match<
	Update.StepWithOutMessage<Model, Message, PageOutMessage>
>({
	SelectedItem:
		({ key }) =>
		(model) => {
			const modal = switcherModals[key]
			return modal ? requested(model, modal) : switchedOrganization(model, key)
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

const foldOrgSwitcher = Update.foldChild({
	update: Menu.update,
	read: (model: Model) => Option.some(model.orgSwitcher),
	write: (model, orgSwitcher) => modifyFields(model, { orgSwitcher: () => orgSwitcher }),
	toParentMessage: (message) => Message.GotOrgSwitcherMessage({ message }),
	foldOutMessage: foldOrgSwitcherOutMessage,
})

const foldChannelsSidebar = (
	model: Model,
	step: (sidebar: ChannelsSidebar.Model) => ChannelsSidebar.SidebarReturn,
): Update.Return<Model, Message> =>
	Update.foldChildStep<Model, Message, ChannelsSidebar.Model, ChannelsSidebar.Message>({
		update: step,
		read: (parent: Model) => Option.some(parent.channelsSidebar),
		write: (parent: Model, channelsSidebar: ChannelsSidebar.Model) =>
			modifyFields(parent, { channelsSidebar: () => channelsSidebar }),
		toParentMessage: (message: ChannelsSidebar.Message) => Message.GotChannelsSidebarMessage({ message }),
	})(model)

export const update = (model: Model, message: Message, context: Context): ShellReturn => {
	const result = Message.match<ShellReturn>(message, {
		GotChannelsSidebarMessage: ({ message }) =>
			message._tag === "ClickedBrowseChannels"
				? // `openChannelsBrowser` passes `initialPage`, which the palette never reads: it opens home.
					requested(model, PageOutMessage.RequestedCommandPalette({ page: "home" }))
				: message._tag === "ClickedAddDirectMessage"
					? requested(model, PageOutMessage.RequestedModal({ modal: { _tag: "CreateDm" } }))
					: foldChannelsSidebar(model, (sidebar) => ChannelsSidebar.update(sidebar, message)),
		GotUserMenuMessage: ({ message }) => foldUserMenu(model, message),
		GotOrgSwitcherMessage: ({ message }) => foldOrgSwitcher(model, message),
		UpdatedUserOrganizations: ({ organizations }) => ({
			model: modifyFields(model, { userOrganizations: () => organizations }),
		}),
		UpdatedUnreadNotificationCount: ({ count }) => ({
			model: modifyFields(model, { unreadNotificationCount: () => count }),
		}),
		UpdatedSettingsChannel: ({ channel }) => ({
			model: modifyFields(model, { settingsChannel: () => channel }),
		}),
		ToggledSidebar: ({ isOpen }) => ({ model: modifyFields(model, { isSidebarOpen: () => isOpen }) }),
		ToggledSection: ({ sectionId }) => ({
			model: modifyFields(model, {
				collapsedSectionIds: (ids) =>
					ids.includes(sectionId) ? ids.filter((id) => id !== sectionId) : [...ids, sectionId],
			}),
		}),
		ResizedPanel: ({ panel, width }) => ({
			model: modifyFields(model, { panelWidths: (widths) => ({ ...widths, [panel]: width }) }),
		}),
	})
	return { ...result, model: withMenuEntries(result.model, context) }
}

/** The root learned a new route, organization, user or role. */
export const informContext = (model: Model, context: Context): Update.Return<Model, Message> =>
	foldChannelsSidebar(withMenuEntries(model, context), (sidebar) =>
		ChannelsSidebar.setContext(sidebar, {
			organizationId: context.organizationId,
			currentUserId: context.currentUserId,
		}),
	)
