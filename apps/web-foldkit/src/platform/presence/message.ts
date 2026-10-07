import { ChannelId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"

export const Message = defineMessageUnion({
	/** The org layout's user and route channel, as of `nowMs` (null user: outside the layout). */
	ChangedContext: {
		userId: Schema.NullOr(UserId),
		activeChannelId: Schema.NullOr(ChannelId),
		nowMs: Schema.Number,
	},
	/** Input in this tab (throttled). */
	DetectedActivity: { atMs: Schema.Number },
	/** Another tab saw input. */
	ReceivedRemoteActivity: { atMs: Schema.Number },
	/** The AFK deadline of the latest activity passed. */
	ReachedAfkTimeout: { nowMs: Schema.Number },
	ElapsedSyncDebounce: { version: Schema.Number },
	SucceededSendPresenceUpdate: {},
	FailedSendPresenceUpdate: { reason: Schema.String },
	TickedHeartbeat: {},
	SucceededSendHeartbeat: {},
	FailedSendHeartbeat: { reason: Schema.String },
	CompletedBroadcastActivity: {},
})
export type Message = typeof Message.Type
