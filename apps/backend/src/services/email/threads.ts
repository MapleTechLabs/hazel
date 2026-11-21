/**
 * Support mailboxes' conversations in the directory (D1, `email_threads` and
 * `email_thread_messages`; `docs/customers/email.md`). D1 has no transactions: each write is one
 * idempotent statement, safe to repeat when an email is redelivered.
 */
import { SQLite, schema } from "@hazel/db"
import { Email } from "@hazel/integrations"
import type { OrganizationId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { Directory } from "../directory"

/** An address on a conversation, lower-cased, with the name its sender gave. */
export type EmailParticipant = schema.EmailParticipant

/** D1 binds at most 100 parameters a statement. */
const LOOKUP_MAX = 90

/**
 * The conversation an email continues: the root of the first of `messageIds` (its `In-Reply-To`,
 * then its `References`, newest first) the mailbox has seen. `None`: a new conversation.
 */
export const conversationRootOf = (mailboxId: string, messageIds: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const ids = [...new Set(messageIds)].slice(0, LOOKUP_MAX)
		if (ids.length === 0) return Option.none<string>()
		const directory = yield* Directory
		const rows = yield* directory.db.run(
			SQLite.from(schema.emailThreadMessagesTable)
				.select("messageId", "rootMessageId")
				.where(($) => [$.mailboxId.eq(mailboxId), $.messageId.in_(...ids)]),
		)
		const roots = new Map(rows.map((row) => [row.messageId, row.rootMessageId]))
		for (const id of ids) {
			const root = roots.get(id)
			if (root !== undefined) return Option.some(root)
		}
		return Option.none<string>()
	}).pipe(Effect.withSpan("Email.conversationRootOf"))

export const threadOf = (mailboxId: string, rootMessageId: string) =>
	Effect.flatMap(Directory, (directory) =>
		directory.db.first(
			SQLite.from(schema.emailThreadsTable)
				.select()
				.where(($) => [$.mailboxId.eq(mailboxId), $.rootMessageId.eq(rootMessageId)])
				.limit(1),
		),
	).pipe(Effect.withSpan("Email.threadOf"))

/** Record a message of a conversation (inbound or one Hazel sent); a repeat changes nothing. */
export const recordThreadMessage = (row: {
	readonly mailboxId: string
	readonly messageId: string
	readonly rootMessageId: string
	readonly direction: "inbound" | "outbound"
}) =>
	Effect.flatMap(Directory, (directory) =>
		directory.db.run(
			SQLite.insertInto(schema.emailThreadMessagesTable).values(row).onConflictDoNothing(),
		),
	).pipe(Effect.asVoid, Effect.withSpan("Email.recordThreadMessage"))

/** Participants in order, each address once (the first name given wins, a later one fills a gap). */
export const mergeParticipants = (
	current: ReadonlyArray<EmailParticipant>,
	add: ReadonlyArray<EmailParticipant>,
): ReadonlyArray<EmailParticipant> => {
	const byAddress = new Map<string, EmailParticipant>()
	for (const participant of [...current, ...add]) {
		const address = participant.address.trim().toLowerCase()
		if (address.length === 0) continue
		const held = byAddress.get(address)
		if (held === undefined || (held.name === null && participant.name !== null)) {
			byAddress.set(address, { address, name: held?.name ?? participant.name })
		}
	}
	return [...byAddress.values()]
}

/**
 * Fold one message into its conversation: participants added, the chain extended, the latest
 * message moved. A new conversation is created with `subject`.
 */
export const upsertThread = (input: {
	readonly mailboxId: string
	readonly rootMessageId: string
	readonly organizationId: OrganizationId
	readonly subject: string
	readonly messageId: string
	readonly references: ReadonlyArray<string>
	readonly participants: ReadonlyArray<EmailParticipant>
}) =>
	Effect.gen(function* () {
		const directory = yield* Directory
		const held = yield* threadOf(input.mailboxId, input.rootMessageId)
		const now = new Date()
		const participants = mergeParticipants(
			Option.match(held, { onNone: () => [], onSome: (row) => row.participants }),
			input.participants,
		)
		const referenceIds = Email.referencesChain(
			Option.match(held, { onNone: () => [input.rootMessageId], onSome: (row) => row.referenceIds }),
			[...input.references, input.messageId],
		)
		yield* directory.db.run(
			SQLite.insertInto(schema.emailThreadsTable)
				.values({
					mailboxId: input.mailboxId,
					rootMessageId: input.rootMessageId,
					organizationId: input.organizationId,
					subject: input.subject,
					participants,
					referenceIds,
					lastMessageId: input.messageId,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: ["mailboxId", "rootMessageId"],
					set: { participants, referenceIds, lastMessageId: input.messageId, updatedAt: now },
				}),
		)
	}).pipe(Effect.withSpan("Email.upsertThread"))
