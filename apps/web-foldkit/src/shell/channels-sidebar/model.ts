import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import {
	ChannelCustomer,
	ChannelEntry,
	ConnectMount,
	DmChannel,
	Membership,
	PartnerOrg,
	SyncedChannel,
	Section,
	UnreadChannel,
	UnreadCount,
} from "./rows"

/**
 * The organization's channel data the Foldkit host still reads now that the list itself is the
 * shell's (`shared-screens/src/channel-sidebar/`): the tab badge's unread channels, every page's
 * channel marks (`Shared.channelLinks`) and the Alt+Arrow channel order. It goes with the host (Z1).
 */

// MODEL

export const Model = Schema.Struct({
	organizationId: Schema.NullOr(OrganizationId),
	currentUserId: Schema.NullOr(UserId),
	membership: Schema.NullOr(Membership),
	sections: Schema.Array(Section),
	/** Keyed by section id, `"default"` for channels without a section. */
	sectionChannels: Schema.Record(Schema.String, Schema.Array(ChannelEntry)),
	favorites: Schema.Array(ChannelEntry),
	/** Channels linked to a customer: listed under Customers, not in their section. */
	channelCustomers: Schema.Array(ChannelCustomer),
	dmChannelIds: Schema.Array(ChannelId),
	dmChannels: Schema.Record(Schema.String, Schema.NullOr(DmChannel)),
	unreadCounts: Schema.Array(UnreadCount),
	/** Channels with messages the user has not read (not muted for good), sorted. */
	unreadChannels: Schema.Array(UnreadChannel),
	connectMounts: Schema.Array(ConnectMount),
	organizations: Schema.Array(PartnerOrg),
	syncedChannels: Schema.Array(SyncedChannel),
	/** Which of the lists that start empty have arrived; an empty one is "none" only then. */
	loaded: Schema.Struct({
		sections: Schema.Boolean,
		favorites: Schema.Boolean,
		channelCustomers: Schema.Boolean,
		dmChannelIds: Schema.Boolean,
	}),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	UpdatedMembership: { membership: Schema.NullOr(Membership) },
	UpdatedSections: { sections: Schema.Array(Section) },
	UpdatedSectionChannels: { sectionKey: Schema.String, channels: Schema.Array(ChannelEntry) },
	UpdatedFavorites: { channels: Schema.Array(ChannelEntry) },
	UpdatedChannelCustomers: { customers: Schema.Array(ChannelCustomer) },
	UpdatedDmChannelIds: { channelIds: Schema.Array(ChannelId) },
	UpdatedDmChannel: { channelId: ChannelId, channel: Schema.NullOr(DmChannel) },
	UpdatedUnreadCounts: { counts: Schema.Array(UnreadCount) },
	UpdatedUnreadChannels: { channels: Schema.Array(UnreadChannel) },
	UpdatedConnectMounts: { mounts: Schema.Array(ConnectMount) },
	UpdatedOrganizations: { organizations: Schema.Array(PartnerOrg) },
	UpdatedSyncedChannels: { synced: Schema.Array(SyncedChannel) },
})
export type Message = typeof Message.Type

export const emptyData = {
	membership: null,
	sections: [],
	sectionChannels: {},
	favorites: [],
	channelCustomers: [],
	dmChannelIds: [],
	dmChannels: {},
	unreadCounts: [],
	unreadChannels: [],
	connectMounts: [],
	organizations: [],
	syncedChannels: [],
	loaded: { sections: false, favorites: false, channelCustomers: false, dmChannelIds: false },
} satisfies Omit<Model, "organizationId" | "currentUserId">
