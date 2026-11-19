import type * as Customers from "@hazel/domain/customers"
import type { CustomerAccountId, OrganizationId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import type { Stream } from "effect"
import { customerNoteCollection } from "~/db/collections"
import { msOf, withCustomersSource } from "../../../customers/queries"
import { liveQueryStream } from "../../../data/live-query"
import type { NoteRow } from "./model"

/** The customer page's own live query: the account's notes. */

const toNoteRow = (note: Customers.Note): NoteRow => ({
	id: note.id,
	accountId: note.accountId,
	authorUserId: note.authorUserId,
	body: note.body,
	pinned: note.pinned,
	signalId: note.signalId,
	editedAtMs: note.editedAt === null ? null : msOf(note.editedAt),
	createdAtMs: msOf(note.createdAt),
})

export const notesStream = <Message>(
	organizationId: OrganizationId,
	accountId: CustomerAccountId,
	toMessage: (notes: ReadonlyArray<NoteRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.Note, Message>(
			(q) =>
				q
					.from({ note: customerNoteCollection })
					.where(({ note }) =>
						and(
							eq(note.organizationId, organizationId),
							eq(note.accountId, accountId),
							isNull(note.deletedAt),
						),
					)
					.orderBy(({ note }) => note.createdAt, "desc"),
			(rows) => toMessage(rows.map(toNoteRow)),
		),
	)
