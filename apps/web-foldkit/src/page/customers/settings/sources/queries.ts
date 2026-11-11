import * as Customers from "@hazel/domain/customers"
import { CustomerConnectionId, CustomerSyncRunId, type OrganizationId, UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Schema, type Stream } from "effect"
import { customerConnectionCollection, customerSyncRunCollection } from "~/db/collections"
import { msOf, withCustomersSource } from "../../../../customers/queries"
import { liveQueryStream } from "../../../../data/live-query"

/**
 * The Data sources page's live rows: every connection of the org (disconnected ones too, shown as
 * stale) and the sync runs the source keeps (the last 7 days), dates as epoch ms.
 */

export const ConnectionRow = Schema.Struct({
	id: CustomerConnectionId,
	provider: Customers.CustomerProvider,
	status: Customers.ConnectionStatus,
	externalAccountName: Schema.NullOr(Schema.String),
	config: Customers.ConnectionConfig,
	connectedBy: UserId,
	connectedAtMs: Schema.Number,
	hasWebhookSecret: Schema.Boolean,
	lastSyncAtMs: Schema.NullOr(Schema.Number),
	lastSuccessAtMs: Schema.NullOr(Schema.Number),
	lastErrorAtMs: Schema.NullOr(Schema.Number),
	lastError: Schema.NullOr(Customers.SyncError),
	consecutiveFailures: Schema.Int,
	nextSyncAtMs: Schema.NullOr(Schema.Number),
	stats: Customers.SyncStats,
	disconnectedAtMs: Schema.NullOr(Schema.Number),
})
export type ConnectionRow = typeof ConnectionRow.Type

export const SyncRunRow = Schema.Struct({
	id: CustomerSyncRunId,
	connectionId: CustomerConnectionId,
	trigger: Customers.SyncTrigger,
	status: Customers.SyncRunStatus,
	startedAtMs: Schema.Number,
	finishedAtMs: Schema.NullOr(Schema.Number),
	progress: Schema.NullOr(Customers.SyncProgress),
	stats: Customers.SyncStats,
	error: Schema.NullOr(Customers.SyncError),
})
export type SyncRunRow = typeof SyncRunRow.Type

type JsonDate = Customers.Connection["connectedAt"]
const msOrNull = (date: JsonDate | null): number | null => (date === null ? null : msOf(date))

export const toConnectionRow = (connection: Customers.Connection): ConnectionRow => ({
	id: connection.id,
	provider: connection.provider,
	status: connection.status,
	externalAccountName: connection.externalAccountName,
	config: connection.config,
	connectedBy: connection.connectedBy,
	connectedAtMs: msOf(connection.connectedAt),
	hasWebhookSecret: connection.hasWebhookSecret,
	lastSyncAtMs: msOrNull(connection.lastSyncAt),
	lastSuccessAtMs: msOrNull(connection.lastSuccessAt),
	lastErrorAtMs: msOrNull(connection.lastErrorAt),
	lastError: connection.lastError,
	consecutiveFailures: connection.consecutiveFailures,
	nextSyncAtMs: msOrNull(connection.nextSyncAt),
	stats: connection.stats,
	disconnectedAtMs: msOrNull(connection.disconnectedAt),
})

export const toSyncRunRow = (run: Customers.SyncRun): SyncRunRow => ({
	id: run.id,
	connectionId: run.connectionId,
	trigger: run.trigger,
	status: run.status,
	startedAtMs: msOf(run.startedAt),
	finishedAtMs: msOrNull(run.finishedAt),
	progress: run.progress,
	stats: run.stats,
	error: run.error,
})

export const connectionsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (connections: ReadonlyArray<ConnectionRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.Connection, Message>(
			(q) =>
				q
					.from({ connection: customerConnectionCollection })
					.where(({ connection }) => eq(connection.organizationId, organizationId)),
			(rows) => toMessage(rows.map(toConnectionRow)),
		),
	)

/** Newest first. */
export const syncRunsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (runs: ReadonlyArray<SyncRunRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.SyncRun, Message>(
			(q) =>
				q
					.from({ run: customerSyncRunCollection })
					.where(({ run }) => eq(run.organizationId, organizationId))
					.orderBy(({ run }) => run.startedAt, "desc"),
			(rows) => toMessage(rows.map(toSyncRunRow)),
		),
	)
