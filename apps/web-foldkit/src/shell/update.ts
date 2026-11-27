import type { OrganizationId, UserId } from "@hazel/schema"
import { Option } from "effect"
import { Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { PageOutMessage } from "../page/out-message"
import type { HazelRpc } from "../rpc"
import * as Modal from "../ui/modal"
import * as ChannelsSidebar from "./channels-sidebar"
import * as CustomersSidebar from "./customers-sidebar"
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
	userOrganizations: [],
	notifications: Notifications.init(),
	customersSidebar: CustomersSidebar.init(),
	isSidebarOpen: false,
	isSidebarCollapsed: false,
})

// UPDATE

export type ShellReturn = Update.ReturnWithOutMessage<Model, Message, PageOutMessage, HazelRpc>
type Step = Update.StepWithOutMessage<Model, Message, PageOutMessage, HazelRpc>

/** The sidebar's Commands, plus its OutMessage (modals, navigation, toasts) for the root. */
const foldChannelsSidebar = Update.foldChild({
	update: ChannelsSidebar.update,
	read: (model: Model) => Option.some(model.channelsSidebar),
	write: (model, channelsSidebar) => modifyFields(model, { channelsSidebar: () => channelsSidebar }),
	toParentMessage: (message) => Message.GotChannelsSidebarMessage({ message }),
	toParentOutMessage: (outMessage: PageOutMessage) => outMessage,
})

/** The sidebar's Commands (saving the view layout), plus its toasts for the root. */
const foldCustomersSidebar = (context: Context) =>
	Update.foldChild({
		update: (sidebar: CustomersSidebar.Model, message: CustomersSidebar.Message) =>
			CustomersSidebar.update(sidebar, message, context.currentUserId),
		read: (model: Model) => Option.some(model.customersSidebar),
		write: (model, customersSidebar) => modifyFields(model, { customersSidebar: () => customersSidebar }),
		toParentMessage: (message) => Message.GotCustomersSidebarMessage({ message }),
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
		UpdatedUserOrganizations: ({ organizations }) => ({
			model: modifyFields(model, { userOrganizations: () => organizations }),
		}),
		GotNotificationsMessage: ({ message }) => foldNotifications(model, message),
		GotCustomersSidebarMessage: ({ message }) => foldCustomersSidebar(context)(model, message),
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
	return modifyFields(model, {
		channelsSidebar: () => channelsSidebar,
		customersSidebar: (sidebar) => CustomersSidebar.setOrganization(sidebar, context.organizationId),
	})
}
