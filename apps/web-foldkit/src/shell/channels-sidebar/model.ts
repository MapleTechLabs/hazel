import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import {
	ChannelEntry,
	ConnectMount,
	DiscoverableChannel,
	DmChannel,
	Membership,
	PartnerOrg,
	Presence,
	Section,
	UnreadCount,
} from "./rows"

// MODEL

export const Model = Schema.Struct({
	organizationId: Schema.NullOr(OrganizationId),
	currentUserId: Schema.NullOr(UserId),
	/** `presenceNowSignal`: wall clock for deriving stale presence. */
	nowMs: Schema.Number,
	membership: Schema.NullOr(Membership),
	sections: Schema.Array(Section),
	/** Keyed by section id, `"default"` for channels without a section. */
	sectionChannels: Schema.Record(Schema.String, Schema.Array(ChannelEntry)),
	favorites: Schema.Array(ChannelEntry),
	dmChannelIds: Schema.Array(ChannelId),
	dmChannels: Schema.Record(Schema.String, Schema.NullOr(DmChannel)),
	presence: Schema.Array(Presence),
	unreadCounts: Schema.Array(UnreadCount),
	connectMounts: Schema.Array(ConnectMount),
	organizations: Schema.Array(PartnerOrg),
	memberChannelIds: Schema.NullOr(Schema.Array(ChannelId)),
	discoverableChannels: Schema.Array(DiscoverableChannel),
	/** `useFeatureHint("create-channel")`, persisted across organizations. */
	isCreateChannelHintDismissed: Schema.Boolean,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	ChangedContext: {},
	CompletedScrollActiveIntoView: {},
	TickedPresenceClock: { nowMs: Schema.Number },
	UpdatedMembership: { membership: Schema.NullOr(Membership) },
	UpdatedSections: { sections: Schema.Array(Section) },
	UpdatedSectionChannels: { sectionKey: Schema.String, channels: Schema.Array(ChannelEntry) },
	UpdatedFavorites: { channels: Schema.Array(ChannelEntry) },
	UpdatedDmChannelIds: { channelIds: Schema.Array(ChannelId) },
	UpdatedDmChannel: { channelId: ChannelId, channel: Schema.NullOr(DmChannel) },
	UpdatedPresence: { presence: Schema.Array(Presence) },
	UpdatedUnreadCounts: { counts: Schema.Array(UnreadCount) },
	UpdatedConnectMounts: { mounts: Schema.Array(ConnectMount) },
	UpdatedOrganizations: { organizations: Schema.Array(PartnerOrg) },
	UpdatedMemberChannelIds: { channelIds: Schema.Array(ChannelId) },
	UpdatedDiscoverableChannels: { channels: Schema.Array(DiscoverableChannel) },
	LoadedDismissedHints: { isCreateChannelHintDismissed: Schema.Boolean },
	ClickedDismissCreateChannelHint: {},
	CompletedPersistDismissedHint: {},
})
export type Message = typeof Message.Type

export const emptyData = {
	membership: null,
	sections: [],
	sectionChannels: {},
	favorites: [],
	dmChannelIds: [],
	dmChannels: {},
	presence: [],
	unreadCounts: [],
	connectMounts: [],
	organizations: [],
	memberChannelIds: null,
	discoverableChannels: [],
} satisfies Omit<Model, "organizationId" | "currentUserId" | "nowMs" | "isCreateChannelHintDismissed">
