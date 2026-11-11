import type * as Customers from "@hazel/domain/customers"
import type { CustomerAccountId, OrganizationId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import type { Stream } from "effect"
import { customerMetricDefinitionCollection, customerNoteCollection } from "~/db/collections"
import { msOf, withCustomersSource } from "../../../customers/queries"
import { liveQueryStream } from "../../../data/live-query"
import type { MetricRow, NoteRow } from "./model"

/** The customer page's own live queries: the account's notes and the metric picker's metrics. */

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

export const metricsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (metrics: ReadonlyArray<MetricRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.MetricDefinition, Message>(
			(q) =>
				q
					.from({ metric: customerMetricDefinitionCollection })
					.where(({ metric }) => eq(metric.organizationId, organizationId))
					.orderBy(({ metric }) => metric.name, "asc"),
			(rows) =>
				toMessage(
					rows
						// The 30-day rollup reads like a duplicate of daily actives on a daily chart.
						.filter((row) => row.key !== "active_users_30d")
						.map((row) => ({
							key: row.key,
							name: row.name,
							unit: row.customUnit ?? row.unit,
							provider: row.provider,
						})),
				),
		),
	)
