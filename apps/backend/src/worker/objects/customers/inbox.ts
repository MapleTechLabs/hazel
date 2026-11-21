/**
 * Support inboxes in the `CustomersObject` (`docs/customers/email.md` § Issues): a message in an
 * email mailbox's channel is placed on a customer before it runs the usual chat-message hooks. A
 * new conversation is matched by its sender (a contact's exact address, else an account's domain);
 * a reply in a conversation's thread takes the account of the conversation's issue.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { FREE_MAIL_DOMAINS } from "@hazel/domain/customers"
import type { CustomerAccountId } from "@hazel/schema"
import { Effect, Option } from "effect"
import type { InboxMessagePayload } from "../customer-chat-wire"
import { issueAt } from "./issues"

/**
 * The customer a sender's address belongs to (a group's primary, like a linked channel's); several
 * accounts: the most recently active.
 */
export const accountOfEmail = Effect.fn("CustomersInbox.accountOfEmail")(function* (address: string) {
	const db = yield* Database.Database
	const email = address.trim().toLowerCase()
	const byContact = yield* db.first(
		SQLite.from(schema.customerContactsTable, "contact")
			.innerJoin(schema.customerAccountsTable, "account", (contact, account) =>
				account.id.eq(contact.accountId),
			)
			.select(($) => ({ accountId: $.accountId, primaryAccountId: $.account.primaryAccountId }))
			.where(($) => [
				$.deletedAt.isNull(),
				$.account.deletedAt.isNull(),
				SQLite.sql.cond`lower(trim(${$.email}, char(9, 10, 13, 32))) = ${email}`,
			])
			.orderBy(($) => [[$.account.lastActiveAt, "desc"]])
			.limit(1),
	)
	if (Option.isSome(byContact)) {
		return Option.some<CustomerAccountId>(byContact.value.primaryAccountId ?? byContact.value.accountId)
	}
	const domain = email.slice(email.lastIndexOf("@") + 1)
	if (domain.length === 0 || !email.includes("@") || FREE_MAIL_DOMAINS.has(domain)) {
		return Option.none<CustomerAccountId>()
	}
	const byDomain = yield* db.first(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "primaryAccountId")
			.where(($) => [
				$.deletedAt.isNull(),
				SQLite.sql
					.cond`EXISTS (SELECT 1 FROM json_each(${$.domains}) WHERE lower(trim(json_each.value)) = ${domain})`,
			])
			.orderBy(($) => [[$.lastActiveAt, "desc"]])
			.limit(1),
	)
	return Option.map(byDomain, (row) => row.primaryAccountId ?? row.id)
})

/** Where a support inbox's message belongs: its account, or `None` (it opens or joins nothing). */
export const inboxAccountOf = Effect.fn("CustomersInbox.accountOf")(function* (payload: InboxMessagePayload) {
	const isReply = payload.messageChannelId !== payload.channelId
	if (isReply) {
		if (payload.threadRootMessageId === null) return Option.none<CustomerAccountId>()
		const issue = yield* issueAt(payload.channelId, payload.threadRootMessageId)
		return Option.map(issue, (row) => row.accountId)
	}
	if (payload.author.side !== "customer" || payload.author.email === null) {
		return Option.none<CustomerAccountId>()
	}
	return yield* accountOfEmail(payload.author.email)
})
