import {
	type ConnectionRow,
	type SyncRunRow,
	toConnectionRows,
	toSyncRunRow,
} from "@hazel/shared-screens/customers/settings/sources/rows"
import * as Customers from "@hazel/domain/customers"
import {
	CustomerConnectionId,
	CustomerImpersonationId,
	CustomerMetricDefinitionId,
	CustomerSyncRunId,
	type OrganizationId,
	UserId,
} from "@hazel/schema"
import { and, eq } from "@tanstack/db"
import { Option, Schema, type Stream } from "effect"
import {
	customerAccountCollection,
	customerConnectionCollection,
	customerImpersonationCollection,
	customerMetricDefinitionCollection,
	customerSyncRunCollection,
} from "~/db/collections"
import { msOf, withCustomersSource } from "../../../../customers/queries"
import { liveQueryStream } from "../../../../data/live-query"

/**
 * The Data sources page's live rows: every connection of the org (disconnected ones too, shown as
 * stale) and the sync runs the source keeps (the last 7 days), dates as epoch ms.
 */

export { ConnectionRow, SyncRunRow } from "@hazel/shared-screens/customers/settings/sources/rows"

/** A source's metric, for its unit: the one the source gives, and the one set by hand. */
export const UnitMetricRow = Schema.Struct({
	id: CustomerMetricDefinitionId,
	key: Schema.String,
	name: Schema.String,
	provider: Customers.CustomerProvider,
	unit: Schema.NullOr(Schema.String),
	customUnit: Schema.NullOr(Schema.String),
})
export type UnitMetricRow = typeof UnitMetricRow.Type

/** One impersonation a member started (synced to admins, the last 30 days). */
export const ImpersonationRow = Schema.Struct({
	id: CustomerImpersonationId,
	userId: UserId,
	/** The contact's name, else email, when it started. */
	contactLabel: Schema.NullOr(Schema.String),
	/** Null: the customer is gone (merged or deleted). */
	accountName: Schema.NullOr(Schema.String),
	createdAtMs: Schema.Finite,
})
export type ImpersonationRow = typeof ImpersonationRow.Type

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
			(rows) => toMessage(toConnectionRows(rows)),
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

/** The sources' own metrics (not Hazel's built-ins), by name. */
export const unitMetricsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (metrics: ReadonlyArray<UnitMetricRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.MetricDefinition, Message>(
			(q) =>
				q
					.from({ metric: customerMetricDefinitionCollection })
					.where(({ metric }) =>
						and(eq(metric.organizationId, organizationId), eq(metric.builtIn, false)),
					)
					.orderBy(({ metric }) => metric.name, "asc"),
			(rows) =>
				toMessage(
					rows.flatMap((row) =>
						row.provider === null
							? []
							: [
									{
										id: row.id,
										key: row.key,
										name: row.name,
										provider: row.provider,
										unit: row.unit,
										customUnit: row.customUnit,
									},
								],
					),
				),
		),
	)

/** The recent impersonations shown, newest first. */
const IMPERSONATION_LIMIT = 20

/** The last impersonations, newest first, with their customer's name. */
export const impersonationsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (impersonations: ReadonlyArray<ImpersonationRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<
			{ readonly impersonation: Customers.Impersonation; readonly account?: Customers.Account },
			Message
		>(
			(q) =>
				q
					.from({ impersonation: customerImpersonationCollection })
					.leftJoin({ account: customerAccountCollection }, ({ impersonation, account }) =>
						eq(impersonation.accountId, account.id),
					)
					.where(({ impersonation }) => eq(impersonation.organizationId, organizationId))
					.orderBy(({ impersonation }) => impersonation.createdAt, "desc")
					.limit(IMPERSONATION_LIMIT),
			(rows) =>
				toMessage(
					rows.map(({ impersonation, account }) => ({
						id: impersonation.id,
						userId: impersonation.userId,
						contactLabel: impersonation.contactLabel,
						accountName:
							account === undefined || account.deletedAt !== null ? null : account.name,
						createdAtMs: msOf(impersonation.createdAt),
					})),
				),
		),
	)
