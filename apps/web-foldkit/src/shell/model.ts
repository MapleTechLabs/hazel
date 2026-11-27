import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Modal from "../ui/modal"
import * as ChannelsSidebar from "./channels-sidebar"
import * as CustomersSidebar from "./customers-sidebar"
import * as Notifications from "./notifications"

/** The shell around every org page; it lives at the root, so it survives navigation. */

// MODEL

/** An organization in the switcher (`SwitchServerMenu`). */
export const SwitcherOrg = Schema.Struct({
	id: OrganizationId,
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
})
export type SwitcherOrg = typeof SwitcherOrg.Type

export const Model = Schema.Struct({
	channelsSidebar: ChannelsSidebar.Model,
	/** The user's organizations, for the next and previous organization keys. */
	userOrganizations: Schema.Array(SwitcherOrg),
	/** Unread notification ids and the optimistic "Mark all as read" state. */
	notifications: Notifications.Model,
	/** The Customers sidebar's badge count and saved views. */
	customersSidebar: CustomersSidebar.Model,
	/** `isOpenOnMobile`: the sidebar sheet opened from the header or the bottom nav. */
	isSidebarOpen: Schema.Boolean,
	/** Desktop: the sidebar docked to its nav rail (`sidebar.toggle`, Mod+B). */
	isSidebarCollapsed: Schema.Boolean,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	GotChannelsSidebarMessage: { message: ChannelsSidebar.Message },
	UpdatedUserOrganizations: { organizations: Schema.Array(SwitcherOrg) },
	GotNotificationsMessage: { message: Notifications.Message },
	GotCustomersSidebarMessage: { message: CustomersSidebar.Message },
	ToggledSidebar: { isOpen: Schema.Boolean },
	/** Desktop: dock the sidebar to its nav rail, or expand it again (Mod+Shift+D). */
	ToggledSidebarCollapsed: {},
	GotMobileSidebarMessage: { message: Modal.Message },
})
export type Message = typeof Message.Type
