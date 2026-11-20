/**
 * Who writes in channels linked to customers (`docs/customers/author-side.md`).
 *
 * - `customer_chat_authors` (`OrgObject`): each author seen in the org's linked channels, with
 *   their side (customer, team, bot, unknown), why, and a member's manual override. Synced to the
 *   org's members only, never to Connect guests.
 * - `customer_chat_participants` (`CustomersObject`): per account, who wrote in its linked
 *   channels and when. Written from the org's `customers.chatMessage` stream.
 */
import { AuthorSide, AuthorSideOverride, AuthorSideReason, ExternalWorkspace } from "@hazel/domain/customers"
import { ChannelId, CustomerAccountId, CustomerContactId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { textEnum, timestamptz, uuid } from "./columns"

export const customerChatAuthorsTable = SQLite.table("customer_chat_authors", {
	columns: {
		userId: uuid(UserId),
		organizationId: uuid(OrganizationId),
		side: textEnum(AuthorSide.literals),
		reason: textEnum(AuthorSideReason.literals),
		/** Set by a member; wins over the facts (bots excepted). */
		override: SQLite.nullable(textEnum(AuthorSideOverride.literals)),
		overrideBy: SQLite.nullable(uuid(UserId)),
		overrideAt: SQLite.nullable(timestamptz),
		/** A Slack author's workspace against the org's own, as chat sync last saw it. */
		externalWorkspace: SQLite.nullable(textEnum(ExternalWorkspace.literals)),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["userId"],
})
export type CustomerChatAuthor = SQLite.SelectRowOf<typeof customerChatAuthorsTable>

export const customerChatParticipantsTable = SQLite.table("customer_chat_participants", {
	columns: {
		accountId: uuid(CustomerAccountId),
		userId: uuid(UserId),
		organizationId: uuid(OrganizationId),
		side: textEnum(AuthorSide.literals),
		reason: textEnum(AuthorSideReason.literals),
		/** The account's contact with the author's email, when there is one. */
		contactId: SQLite.nullable(uuid(CustomerContactId)),
		name: SQLite.text,
		avatarUrl: SQLite.nullable(SQLite.text),
		firstMessageAt: timestamptz,
		lastMessageAt: timestamptz,
		/** The linked channel of the last message (a thread's parent). */
		lastChannelId: uuid(ChannelId),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["accountId", "userId"],
	indexes: [SQLite.index("customer_chat_participants_user_idx", ["userId"])],
})
export type CustomerChatParticipant = SQLite.SelectRowOf<typeof customerChatParticipantsTable>
