/**
 * The Data sources pages' rows (today's `web-foldkit/.../settings/sources/queries.ts`): every
 * connection of the org (disconnected ones too, shown as stale) and the sync runs the source keeps
 * (the last 7 days), dates as epoch ms, plus the live queries that read them.
 */
import { IntegrationConfig, IntegrationId, isIntegrationId } from "@hazel/customer-integrations"
import * as Customers from "@hazel/domain/customers"
import { CustomerConnectionId, CustomerSyncRunId, type OrganizationId, UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { Option, Schema, type Stream } from "effect"
import type { ClientData } from "@hazel/client-data"
import { withData } from "../../../app/live"
import { msOf, withCustomersSourceIn } from "../../data/queries"

export const ConnectionRow = Schema.Struct({
	id: CustomerConnectionId,
	provider: IntegrationId,
	status: Customers.ConnectionStatus,
	externalAccountName: Schema.NullOr(Schema.String),
	config: IntegrationConfig,
	connectedBy: UserId,
	connectedAtMs: Schema.Finite,
	hasWebhookSecret: Schema.Boolean,
	lastSyncAtMs: Schema.NullOr(Schema.Finite),
	lastSuccessAtMs: Schema.NullOr(Schema.Finite),
	lastErrorAtMs: Schema.NullOr(Schema.Finite),
	lastError: Schema.NullOr(Customers.SyncError),
	consecutiveFailures: Schema.Int,
	nextSyncAtMs: Schema.NullOr(Schema.Finite),
	stats: Customers.SyncStats,
	disconnectedAtMs: Schema.NullOr(Schema.Finite),
})
export type ConnectionRow = typeof ConnectionRow.Type

export const SyncRunRow = Schema.Struct({
	id: CustomerSyncRunId,
	connectionId: CustomerConnectionId,
	trigger: Customers.SyncTrigger,
	status: Customers.SyncRunStatus,
	startedAtMs: Schema.Finite,
	finishedAtMs: Schema.NullOr(Schema.Finite),
	progress: Schema.NullOr(Customers.SyncProgress),
	stats: Customers.SyncStats,
	error: Schema.NullOr(Customers.SyncError),
})
export type SyncRunRow = typeof SyncRunRow.Type

type JsonDate = Customers.Connection["connectedAt"]
const msOrNull = (date: JsonDate | null): number | null => (date === null ? null : msOf(date))

const decodeConfig = Schema.decodeUnknownOption(IntegrationConfig)

const toConnectionRow = (
	connection: Customers.Connection,
	provider: IntegrationId,
	config: IntegrationConfig,
): ConnectionRow => ({
	id: connection.id,
	provider,
	status: connection.status,
	externalAccountName: connection.externalAccountName,
	config,
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

/**
 * The rows the pages can show, each config through its integration's schema (stored ones rely on it
 * for defaults and dropped keys); a row of a provider this build does not know is left out.
 */
export const toConnectionRows = (
	connections: ReadonlyArray<Customers.Connection>,
): ReadonlyArray<ConnectionRow> =>
	connections.flatMap((connection) => {
		const { provider } = connection
		const config = decodeConfig(connection.config)
		return isIntegrationId(provider) && Option.isSome(config)
			? [toConnectionRow(connection, provider, config.value)]
			: []
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

// LIVE QUERIES (over the app's `ClientData`)

/** Every connection of the org, as rows. */
export const connectionsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (connections: ReadonlyArray<ConnectionRow>) => Message,
): Stream.Stream<Message, never, ClientData> =>
	withData((data) =>
		withCustomersSourceIn(data)(
			organizationId,
			data.liveQueryStream<Customers.Connection, Message>(
				(q) =>
					q
						.from({ connection: data.collections.customerConnectionCollection })
						.where(({ connection }) => eq(connection.organizationId, organizationId)),
				(rows) => toMessage(toConnectionRows(rows)),
			),
		),
	)

/** The org's sync runs, newest first. */
export const syncRunsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (runs: ReadonlyArray<SyncRunRow>) => Message,
): Stream.Stream<Message, never, ClientData> =>
	withData((data) =>
		withCustomersSourceIn(data)(
			organizationId,
			data.liveQueryStream<Customers.SyncRun, Message>(
				(q) =>
					q
						.from({ run: data.collections.customerSyncRunCollection })
						.where(({ run }) => eq(run.organizationId, organizationId))
						.orderBy(({ run }) => run.startedAt, "desc"),
				(rows) => toMessage(rows.map(toSyncRunRow)),
			),
		),
	)

/** How many live accounts the org has (identity coverage). */
export const accountCountStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (count: number) => Message,
): Stream.Stream<Message, never, ClientData> =>
	withData((data) =>
		withCustomersSourceIn(data)(
			organizationId,
			data.liveQueryStream<{ readonly id: string }, Message>(
				(q) =>
					q
						.from({ account: data.collections.customerAccountCollection })
						.where(({ account }) =>
							and(eq(account.organizationId, organizationId), isNull(account.deletedAt)),
						)
						.select(({ account }) => ({ id: account.id })),
				(rows) => toMessage(rows.length),
			),
		),
	)
