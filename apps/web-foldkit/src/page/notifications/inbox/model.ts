import { ChannelId, NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"

/**
 * The inbox's tabs, Discord's: `mentions` (what names the user: mentions, replies, @everyone and
 * direct messages), `unreads` (channels with messages the user has not read) and `all`.
 */
export const Tab = Schema.Literals(["mentions", "unreads", "all"])
export type Tab = typeof Tab.Type

/** One row of the legacy `useNotifications` join, flattened to what the item renders. */
export const NotificationItem = Schema.Struct({
	id: NotificationId,
	isUnread: Schema.Boolean,
	createdAtMs: Schema.Finite,
	resourceType: Schema.NullOr(Schema.String),
	/** Why it notifies (`mention`, `reply`, `sla_reply_breach`, …); null on older rows. */
	reason: Schema.NullOr(Schema.String),
	targetedResourceId: Schema.NullOr(Schema.String),
	targetedResourceType: Schema.NullOr(Schema.String),
	messageContent: Schema.NullOr(Schema.String),
	channel: Schema.NullOr(Schema.Struct({ name: Schema.String, type: Schema.String })),
	author: Schema.NullOr(
		Schema.Struct({
			firstName: Schema.String,
			lastName: Schema.String,
			avatarUrl: Schema.NullOr(Schema.String),
		}),
	),
})
export type NotificationItem = typeof NotificationItem.Type

/** The notifications live query: `Loading` until it first emits (legacy `isLoading`). */
export const Notifications = defineTaggedUnion({
	Loading: {},
	Loaded: { items: Schema.Array(NotificationItem) },
})
export type Notifications = typeof Notifications.Type

/** A channel of the user's with someone else's message after their read position (`~/lib/unread`). */
export const UnreadChannelItem = Schema.Struct({
	channelId: ChannelId,
	name: Schema.String,
	type: Schema.String,
	/** The member's `notificationCount`: mentions (and DMs) not yet read. */
	mentionCount: Schema.Finite,
	lastMessageAtMs: Schema.Finite,
	/** A timed mute; the view, which has the clock, leaves the channel out until it ends. */
	mutedUntilMs: Schema.NullOr(Schema.Finite),
})
export type UnreadChannelItem = typeof UnreadChannelItem.Type

export const UnreadChannels = defineTaggedUnion({
	Loading: {},
	Loaded: { channels: Schema.Array(UnreadChannelItem) },
})
export type UnreadChannels = typeof UnreadChannels.Type

/**
 * A channel marked read here whose read position has not synced back yet: hidden while its newest
 * message is no newer than when it was marked, so a message after that shows it again.
 */
export const MarkedRead = Schema.Struct({ channelId: ChannelId, upToMs: Schema.Finite })
export type MarkedRead = typeof MarkedRead.Type

/** Why `notification.update` failed. `NotFound`: the notification is gone, so there is nothing to mark. */
export const MarkReadFailure = Schema.Union([Schema.Literals(["NotFound"]), CommonReason])
export type MarkReadFailure = typeof MarkReadFailure.Type

/** Why `channelMember.clearNotifications` failed. `ChannelNotFound`: the channel is gone. */
export const MarkChannelReadFailure = Schema.Union([Schema.Literals(["ChannelNotFound"]), CommonReason])
export type MarkChannelReadFailure = typeof MarkChannelReadFailure.Type

export const Model = Schema.Struct({
	tab: Tab,
	notifications: Notifications,
	unreadChannels: UnreadChannels,
	markedRead: Schema.Array(MarkedRead),
	/** `channelMember.markAllRead` is in flight (the Unreads header's button shows pending). */
	isMarkingAllRead: Schema.Boolean,
})
export type Model = typeof Model.Type
