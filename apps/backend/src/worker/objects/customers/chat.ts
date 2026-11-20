/**
 * Who writes in the org's linked channels, on the `CustomersObject` side
 * (`docs/customers/author-side.md`). The org classifies each author (customer, team, bot,
 * unknown) and streams the messages here; this object never reads chat.
 *
 * - `customers.chatMessage`: one message in a linked channel or one of its threads. Runs every
 *   hook of `customerChatMessageHooks` in the receiving transaction, in order: the first keeps
 *   `customer_chat_participants`; support issues and SLAs add theirs after it.
 * - `customers.chatAuthorChanged`: a member changed someone's side; their rows follow.
 * - `customers.chatAuthorsBackfill`: a newly linked channel's past authors.
 */
import { Database, type DatabaseError, SQLite, schema } from "@hazel/db"
import type { CustomerAccountId, CustomerContactId, OrganizationId } from "@hazel/schema"
import { Clock, Effect, Option, type Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import {
	type ChatAuthorChangedPayload,
	type ChatAuthorsBackfillPayload,
	type ChatAuthorWire,
	type ChatMessagePayload,
	CustomerChatEffects,
} from "../customer-chat-wire"
import type { EffectReceivers } from "../effects/registry"
import { supportIssueHook } from "./issues"

/**
 * Something that follows each message of a linked channel. `payload.author.side` is the author's
 * side as the org classified it when the message was written. Runs inside the delivery's
 * transaction: write only this object's store; anything else goes through the outbox.
 */
export type CustomerChatMessageHook = (
	payload: ChatMessagePayload,
) => Effect.Effect<void, DatabaseError | Schema.SchemaError, Database.Database | SqlClient>

/** The account's live contact with the author's email (case-insensitive). */
const contactOf = (accountId: CustomerAccountId, email: string | null) =>
	Effect.gen(function* () {
		if (email === null) return null
		const db = yield* Database.Database
		const contact = yield* db.first(
			SQLite.from(schema.customerContactsTable)
				.select("id")
				.where(($) => [
					$.accountId.eq(accountId),
					$.deletedAt.isNull(),
					SQLite.sql.cond`lower(${$.email}) = ${email.toLowerCase()}`,
				])
				.limit(1),
		)
		return Option.match(contact, { onNone: () => null, onSome: (row) => row.id as CustomerContactId })
	})

const later = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b)
const earlier = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b)

/**
 * Upsert one participant: first and last message widen, the rest (side, name, contact) is the
 * latest the org sent. Idempotent: a redelivered message or backfill changes nothing.
 */
const upsertParticipant = Effect.fn("CustomersChat.upsertParticipant")(function* (input: {
	readonly organizationId: OrganizationId
	readonly accountId: CustomerAccountId
	readonly channelId: ChatMessagePayload["channelId"]
	readonly author: ChatAuthorWire
	readonly firstMessageAt: Date
	readonly lastMessageAt: Date
}) {
	const db = yield* Database.Database
	const now = new Date(yield* Clock.currentTimeMillis)
	const contactId = yield* contactOf(input.accountId, input.author.email)
	const held = yield* db.first(
		SQLite.from(schema.customerChatParticipantsTable)
			.select("firstMessageAt", "lastMessageAt", "lastChannelId")
			.where(($) => [$.accountId.eq(input.accountId), $.userId.eq(input.author.userId)])
			.limit(1),
	)
	const row = {
		organizationId: input.organizationId,
		side: input.author.side,
		reason: input.author.reason,
		contactId,
		name: input.author.name,
		avatarUrl: input.author.avatarUrl,
		firstMessageAt: Option.match(held, {
			onNone: () => input.firstMessageAt,
			onSome: (row) => earlier(row.firstMessageAt, input.firstMessageAt),
		}),
		lastMessageAt: Option.match(held, {
			onNone: () => input.lastMessageAt,
			onSome: (row) => later(row.lastMessageAt, input.lastMessageAt),
		}),
		lastChannelId: Option.match(held, {
			onNone: () => input.channelId,
			onSome: (row) =>
				input.lastMessageAt.getTime() >= row.lastMessageAt.getTime()
					? input.channelId
					: row.lastChannelId,
		}),
		updatedAt: now,
	}
	yield* db.run(
		SQLite.insertInto(schema.customerChatParticipantsTable)
			.values({ accountId: input.accountId, userId: input.author.userId, ...row })
			.onConflictDoUpdate({ target: ["accountId", "userId"], set: row }),
	)
})

/** Every account's row of the author takes their current side (and name). */
const applyAuthor = Effect.fn("CustomersChat.applyAuthor")(function* (author: ChatAuthorWire) {
	const db = yield* Database.Database
	const now = new Date(yield* Clock.currentTimeMillis)
	yield* db.run(
		SQLite.update(schema.customerChatParticipantsTable)
			.set({
				side: author.side,
				reason: author.reason,
				name: author.name,
				avatarUrl: author.avatarUrl,
				updatedAt: now,
			})
			.where(($) => [
				$.userId.eq(author.userId),
				SQLite.sql
					.cond`(${$.side} <> ${author.side} OR ${$.reason} <> ${author.reason} OR ${$.name} <> ${author.name})`,
			]),
	)
})

const participantsHook: CustomerChatMessageHook = (payload) =>
	Effect.gen(function* () {
		const at = new Date(payload.createdAt)
		yield* applyAuthor(payload.author)
		yield* upsertParticipant({
			organizationId: payload.organizationId,
			accountId: payload.accountId,
			channelId: payload.channelId,
			author: payload.author,
			firstMessageAt: at,
			lastMessageAt: at,
		})
	})

/** Every hook a message of a linked channel runs, in order. Support issues and SLAs go after. */
export const customerChatMessageHooks: ReadonlyArray<CustomerChatMessageHook> = [
	participantsHook,
	supportIssueHook,
]

const chatMessage = Effect.fn("CustomersChat.chatMessage")(function* (payload: ChatMessagePayload) {
	yield* Effect.annotateCurrentSpan({
		"customer.account_id": payload.accountId,
		"customer_chat.side": payload.author.side,
		"customer_chat.reason": payload.author.reason,
	})
	for (const hook of customerChatMessageHooks) yield* hook(payload)
})

const chatAuthorChanged = Effect.fn("CustomersChat.chatAuthorChanged")(function* (
	payload: ChatAuthorChangedPayload,
) {
	yield* Effect.annotateCurrentSpan({ "customer_chat.side": payload.author.side })
	yield* applyAuthor(payload.author)
})

const chatAuthorsBackfill = Effect.fn("CustomersChat.chatAuthorsBackfill")(function* (
	payload: ChatAuthorsBackfillPayload,
) {
	yield* Effect.annotateCurrentSpan({
		"customer.account_id": payload.accountId,
		"customer_chat.authors": payload.authors.length,
	})
	for (const entry of payload.authors) {
		yield* upsertParticipant({
			organizationId: payload.organizationId,
			accountId: payload.accountId,
			channelId: payload.channelId,
			author: entry.author,
			firstMessageAt: new Date(entry.firstMessageAt),
			lastMessageAt: new Date(entry.lastMessageAt),
		})
	}
})

export const customerChatReceivers = {
	"customers.chatMessage": chatMessage,
	"customers.chatAuthorChanged": chatAuthorChanged,
	"customers.chatAuthorsBackfill": chatAuthorsBackfill,
} satisfies EffectReceivers<typeof CustomerChatEffects, Database.Database | SqlClient>

/** The kinds only the org's own `OrgObject` sends here. */
export const CUSTOMER_CHAT_KINDS: ReadonlySet<string> = new Set(
	Object.values(CustomerChatEffects).map((kind) => kind.name),
)
