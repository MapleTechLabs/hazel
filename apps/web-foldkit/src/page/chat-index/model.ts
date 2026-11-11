import { ChannelId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import * as Tabs from "../../ui/tabs"

/** One row of `routes/_app/$orgSlug/chat/index.tsx`, already split by type for the signed-in user. */
export const DmParticipant = Schema.Struct({
	userId: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})
export type DmParticipant = typeof DmParticipant.Type

export const ChannelSummary = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	type: Schema.String,
	isMuted: Schema.Boolean,
	isFavorite: Schema.Boolean,
	notificationCount: Schema.Number,
	memberCount: Schema.Number,
	/** Every member, in query order (DM cards use them). */
	members: Schema.Array(DmParticipant),
})
export type ChannelSummary = typeof ChannelSummary.Type

export const ChannelGroups = Schema.Struct({
	publicChannels: Schema.Array(ChannelSummary),
	privateChannels: Schema.Array(ChannelSummary),
	dmChannels: Schema.Array(ChannelSummary),
})
export type ChannelGroups = typeof ChannelGroups.Type

export const Presence = Schema.Struct({
	status: Schema.NullOr(Schema.String),
	lastSeenMs: Schema.NullOr(Schema.Number),
})
export type Presence = typeof Presence.Type

/** The channel live query; `Loading` shows the legacy full-height loader. */
export const Channels = defineTaggedUnion({
	Loading: {},
	Loaded: { groups: ChannelGroups },
})
export type Channels = typeof Channels.Type

export const ChatIndexTab = Schema.Literals(["public", "private", "dms"])
export type ChatIndexTab = typeof ChatIndexTab.Type

export const Model = Schema.Struct({
	channels: Channels,
	/** `useUserPresence` for the other member of each single DM, keyed by user id. */
	presence: Schema.Record(Schema.String, Presence),
	tab: ChatIndexTab,
	/** The tab list's roving focus; the selected tab is `tab`. */
	tabs: Tabs.Model,
})
export type Model = typeof Model.Type

export const TABS_ID = "chat-index-tabs"

export const ChatIndexTabs = Tabs.create<ChatIndexTab>()

/** The other members of a DM, as `DmCard` filters them. */
export const otherMembers = (channel: ChannelSummary, currentUserId: string | undefined) =>
	channel.members.filter((member) => member.userId !== currentUserId)

/** Users whose presence the single-DM cards show. */
export const singleDmPartnerIds = (channels: Channels, currentUserId: string | undefined) =>
	(channels._tag === "Loaded" ? channels.groups.dmChannels : []).flatMap((channel) => {
		const others = otherMembers(channel, currentUserId)
		return channel.type === "single" && others.length === 1 && others[0] ? [others[0].userId] : []
	})
