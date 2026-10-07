import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Menu from "../ui/menu"
import * as Modal from "../ui/modal"
import * as ChannelsSidebar from "./channels-sidebar"

/** The shell around every org page; it lives at the root, so it survives navigation. */

// MODEL

export const SwitcherOrg = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
})

export const ChannelSummary = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	icon: Schema.NullOr(Schema.String),
})
export type ChannelSummary = typeof ChannelSummary.Type

export const Model = Schema.Struct({
	channelsSidebar: ChannelsSidebar.Model,
	userMenu: Menu.Model,
	orgSwitcher: Menu.Model,
	/** The inputs the menus' entries were last built from; rebuilt only when this changes. */
	menuSignature: Schema.String,
	userOrganizations: Schema.Array(SwitcherOrg),
	unreadNotificationCount: Schema.Number,
	/** `channels/$channelId/settings/layout.tsx` header (name and icon). */
	settingsChannel: Schema.NullOr(ChannelSummary),
	/** `useSidebar().isMobile`: the `(max-width: 767px)` media query. */
	isMobile: Schema.Boolean,
	/** `isOpenOnMobile`: the sidebar sheet opened from the header or the bottom nav. */
	isSidebarOpen: Schema.Boolean,
	// Hooks for resizable panels (wave 2).
	collapsedSectionIds: Schema.Array(Schema.String),
	panelWidths: Schema.Record(Schema.String, Schema.Number),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	GotChannelsSidebarMessage: { message: ChannelsSidebar.Message },
	GotUserMenuMessage: { message: Menu.Message },
	GotOrgSwitcherMessage: { message: Menu.Message },
	UpdatedUserOrganizations: { organizations: Schema.Array(SwitcherOrg) },
	UpdatedUnreadNotificationCount: { count: Schema.Number },
	UpdatedSettingsChannel: { channel: Schema.NullOr(ChannelSummary) },
	ToggledSidebar: { isOpen: Schema.Boolean },
	ChangedViewport: { isMobile: Schema.Boolean },
	GotMobileSidebarMessage: { message: Modal.Message },
	ToggledSection: { sectionId: Schema.String },
	ResizedPanel: { panel: Schema.String, width: Schema.Number },
})
export type Message = typeof Message.Type
