import type * as Customers from "@hazel/domain/customers"
import type { OrganizationId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import type { Stream } from "effect"
import { customerMetricDefinitionCollection, customerOverviewLayoutCollection } from "~/db/collections"
import { msOf, withCustomersSource } from "../../../../customers/queries"
import { liveQueryStream } from "../../../../data/live-query"
import type { LayoutRow, MetricRow } from "./model"

/** The page's own live queries over the `customers:<org>` collections: the metrics and the layouts. */

export const toMetricRow = (row: Customers.MetricDefinition): MetricRow => ({
	id: row.id,
	key: row.key,
	name: row.name,
	description: row.description,
	unit: row.customUnit ?? row.unit,
	provider: row.provider,
	builtIn: row.builtIn,
	group: row.group,
	format: row.format,
	aggregation: row.aggregation,
	source: row.source,
	lastRunAtMs: row.lastRunAt === null ? null : msOf(row.lastRunAt),
	lastError: row.lastError,
})

/** Every metric definition of the org, by name. */
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
			(rows) => toMessage(rows.map(toMetricRow)),
		),
	)

/** The org's live layouts, in their order. */
export const layoutsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (layouts: ReadonlyArray<LayoutRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.OverviewLayout, Message>(
			(q) =>
				q
					.from({ layout: customerOverviewLayoutCollection })
					.where(({ layout }) =>
						and(eq(layout.organizationId, organizationId), isNull(layout.deletedAt)),
					)
					.orderBy(({ layout }) => layout.position, "asc"),
			(rows) => toMessage(rows.map((row) => ({ id: row.id, name: row.name, widgets: row.widgets }))),
		),
	)
