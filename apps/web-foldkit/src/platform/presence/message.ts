import { ChannelId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { Sent } from "./model"

export const Message = defineMessageUnion({
	/** The org layout's user and route channel, as of `nowMs` (null user: outside the layout). */
	ChangedContext: {
		userId: Schema.NullOr(UserId),
		activeChannelId: Schema.NullOr(ChannelId),
		nowMs: Schema.Number,
	},
	/** The window gained or lost focus, or the document was shown or hidden. */
	ChangedWindowFocus: { isFocused: Schema.Boolean },
	/** Input in this tab (throttled). */
	DetectedActivity: { atMs: Schema.Number },
	/** Another tab saw input. */
	ReceivedRemoteActivity: { atMs: Schema.Number },
	/** The AFK deadline of the latest activity passed. */
	ReachedAfkTimeout: { nowMs: Schema.Number },
	ElapsedSyncDebounce: { version: Schema.Number },
	/** The server confirmed the write for `userId`; it now holds `sent`. */
	SucceededSendPresenceUpdate: { userId: UserId, sent: Sent },
	FailedSendPresenceUpdate: { userId: UserId, reason: CommonReason },
	/** The backoff after a failed write ran out: sync again. */
	ElapsedSyncRetry: { userId: UserId },
	TickedHeartbeat: {},
	SucceededSendHeartbeat: {},
	FailedSendHeartbeat: { reason: CommonReason },
	CompletedBroadcastActivity: {},
})
export type Message = typeof Message.Type
