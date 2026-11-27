import type { OrganizationId, UserId } from "@hazel/schema"
import { Option } from "effect"
import { Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { PageOutMessage } from "../page/out-message"
import type { HazelRpc } from "../rpc"
import * as ChannelsSidebar from "./channels-sidebar"
import * as Notifications from "./notifications"
import { Message, type Model } from "./model"

// CONTEXT

/** Root state the shell's update reads (passed on every dispatch, never stored). */
export interface Context {
	readonly organizationId: OrganizationId | null
	readonly currentUserId: UserId | null
}

// INIT

export const init = (): Model => ({
	channelsSidebar: ChannelsSidebar.init(),
	userOrganizations: [],
	notifications: Notifications.init(),
	isSidebarCollapsed: false,
})

// UPDATE

export type ShellReturn = Update.ReturnWithOutMessage<Model, Message, PageOutMessage, HazelRpc>

const foldNotifications = Update.foldChild({
	update: Notifications.update,
	read: (model: Model) => Option.some(model.notifications),
	write: (model, notifications) => modifyFields(model, { notifications: () => notifications }),
	toParentMessage: (message) => Message.GotNotificationsMessage({ message }),
})

export const update = (model: Model, message: Message): ShellReturn =>
	Message.match<ShellReturn>(message, {
		GotChannelsSidebarMessage: ({ message }) => ({
			model: modifyFields(model, {
				channelsSidebar: (sidebar) => ChannelsSidebar.update(sidebar, message),
			}),
		}),
		UpdatedUserOrganizations: ({ organizations }) => ({
			model: modifyFields(model, { userOrganizations: () => organizations }),
		}),
		GotNotificationsMessage: ({ message }) => foldNotifications(model, message),
		ToggledSidebarCollapsed: () => ({
			model: modifyFields(model, { isSidebarCollapsed: (collapsed) => !collapsed }),
		}),
	})

/** The root learned a new organization or user. */
export const informContext = (model: Model, context: Context): Model =>
	modifyFields(model, {
		channelsSidebar: (sidebar) => ChannelsSidebar.setContext(sidebar, context),
	})
