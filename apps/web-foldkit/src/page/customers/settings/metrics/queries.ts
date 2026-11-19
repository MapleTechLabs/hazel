import type * as Customers from "@hazel/domain/customers"
import type { OrganizationId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import type { Stream } from "effect"
import { customerMetricDefinitionCollection } from "~/db/collections"
import { msOf, withCustomersSource } from "../../../../customers/queries"
import { liveQueryStream } from "../../../../data/live-query"
import type { MetricRow } from "./model"

/**
 * The page's own live query: every metric definition with what the editor needs (its source, last
 * run). The layouts come from `customers/overview/rows.ts`.
 */

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
