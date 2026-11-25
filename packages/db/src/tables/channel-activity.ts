/**
 * Unread state (`apps/backend/src/worker/objects/org/channel-activity.ts`): each channel's newest
 * message, and how far each member has read each channel. A channel is unread while its newest
 * message is someone else's and newer than the member's read position.
 *
 * - `channel_activity`: kept from the search feed. Its own small table, so a new message re-sends
 *   this row and not the channel's.
 * - `channel_read_state`: the member's own rows, streamed to them alone (no read receipts). No row
 *   is read up to `joinedAt`, or `organizations.readStateSince` when that is later.
 */
import { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { timestamptz, uuid } from "./columns"

export const channelActivityTable = SQLite.table("channel_activity", {
	columns: {
		channelId: uuid(ChannelId),
		organizationId: uuid(OrganizationId),
		lastMessageId: uuid(MessageId),
		lastMessageAt: timestamptz,
		lastMessageAuthorId: uuid(UserId),
	},
	primaryKey: ["channelId"],
})
export type ChannelActivity = SQLite.SelectRowOf<typeof channelActivityTable>

export const channelReadStateTable = SQLite.table("channel_read_state", {
	columns: {
		channelId: uuid(ChannelId),
		userId: uuid(UserId),
		organizationId: uuid(OrganizationId),
		lastReadAt: timestamptz,
	},
	primaryKey: ["channelId", "userId"],
	indexes: [SQLite.index("channel_read_state_user_idx", ["userId"])],
})
export type ChannelReadState = SQLite.SelectRowOf<typeof channelReadStateTable>
