import { OrganizationId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, textEnum, timestamptz, uuid } from "./columns"

/** An address on an email conversation, lower-cased, with the name its sender gave. */
export interface EmailParticipant {
	readonly address: string
	readonly name: string | null
}

/**
 * An email conversation of a support mailbox (directory, D1; `docs/customers/email.md`), keyed by the
 * mailbox and its first message's `Message-ID`. Written by the inbound email handler on each email,
 * and by the outbound delivery after each reply it sends: who the customer side is (the reply's
 * recipients), the subject, and the `References` chain a reply continues.
 */
export const emailThreadsTable = SQLite.table("email_threads", {
	columns: {
		mailboxId: SQLite.text,
		rootMessageId: SQLite.text,
		organizationId: uuid(OrganizationId),
		subject: SQLite.text,
		participants: SQLite.column(jsonb<ReadonlyArray<EmailParticipant>>(), { default: [] }),
		/** `Message-ID`s, root first, at most 20 (the root and the newest). */
		referenceIds: SQLite.column(jsonb<ReadonlyArray<string>>(), { default: [] }),
		lastMessageId: SQLite.text,
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["mailboxId", "rootMessageId"],
	indexes: [SQLite.index("email_threads_organization_idx", ["organizationId"])],
})
export type EmailThread = SQLite.SelectRowOf<typeof emailThreadsTable>

export const emailMessageDirectionEnum = textEnum(["inbound", "outbound"])

/**
 * Every message a mailbox received or sent, by `Message-ID`, with its conversation's root: how an
 * inbound reply's `References` / `In-Reply-To` find their conversation.
 */
export const emailThreadMessagesTable = SQLite.table("email_thread_messages", {
	columns: {
		mailboxId: SQLite.text,
		messageId: SQLite.text,
		rootMessageId: SQLite.text,
		direction: emailMessageDirectionEnum,
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["mailboxId", "messageId"],
})
export type EmailThreadMessage = SQLite.SelectRowOf<typeof emailThreadMessagesTable>
