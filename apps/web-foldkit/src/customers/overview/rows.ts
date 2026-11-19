import * as Customers from "@hazel/domain/customers"
import { CustomerOverviewLayoutId, type OrganizationId, UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { Schema, type Stream } from "effect"
import { customerMetricDefinitionCollection, customerOverviewLayoutCollection } from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import { msOf, withCustomersSource } from "../queries"

/**
 * The synced rows the Overview and the layout settings read (`docs/customers/overview-layouts.md`):
 * the org's layouts and its metric definitions, as plain page rows.
 */

/** A layout as pages keep it: the synced row, its last change as epoch ms. */
export const LayoutRow = Schema.Struct({
	id: CustomerOverviewLayoutId,
	name: Schema.String,
	position: Schema.Number,
	isDefault: Schema.Boolean,
	rule: Customers.LayoutRule,
	widgets: Schema.Array(Customers.OverviewWidget),
	accountCount: Schema.Int,
	updatedBy: Schema.NullOr(UserId),
	updatedAtMs: Schema.Number,
})
export type LayoutRow = typeof LayoutRow.Type

export const toLayoutRow = (layout: Customers.OverviewLayout): LayoutRow => ({
	id: layout.id,
	name: layout.name,
	position: layout.position,
	isDefault: layout.isDefault,
	rule: layout.rule,
	widgets: layout.widgets,
	accountCount: layout.accountCount,
	updatedBy: layout.updatedBy,
	updatedAtMs: msOf(layout.updatedAt),
})

/** The order rules are tried in: the others by position, the default last. */
export const orderedLayouts = (layouts: ReadonlyArray<LayoutRow>): ReadonlyArray<LayoutRow> => [
	...layouts.filter((layout) => !layout.isDefault).sort((left, right) => left.position - right.position),
	...layouts.filter((layout) => layout.isDefault),
]

/** A metric as widgets read it; `unit` is the one set by hand, else the source's. */
export const MetricDef = Schema.Struct({
	key: Schema.String,
	name: Schema.String,
	unit: Schema.NullOr(Schema.String),
	format: Customers.MetricFormat,
	group: Schema.NullOr(Schema.String),
	provider: Schema.NullOr(Customers.CustomerProvider),
	builtIn: Schema.Boolean,
})
export type MetricDef = typeof MetricDef.Type

export const toMetricDef = (metric: Customers.MetricDefinition): MetricDef => ({
	key: metric.key,
	name: metric.name,
	unit: metric.customUnit ?? metric.unit,
	format: metric.format,
	group: metric.group,
	provider: metric.provider,
	builtIn: metric.builtIn,
})

/** A group's metrics by key, in name order: what a group table's rows expand to. */
export const groupKeysOf =
	(metrics: ReadonlyArray<MetricDef> | null) =>
	(group: string): ReadonlyArray<string> =>
		(metrics ?? []).filter((metric) => metric.group === group).map((metric) => metric.key)

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
			(rows) => toMessage(rows.map(toLayoutRow)),
		),
	)

export const metricDefsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (metrics: ReadonlyArray<MetricDef>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.MetricDefinition, Message>(
			(q) =>
				q
					.from({ metric: customerMetricDefinitionCollection })
					.where(({ metric }) => eq(metric.organizationId, organizationId))
					.orderBy(({ metric }) => metric.name, "asc"),
			(rows) => toMessage(rows.map(toMetricDef)),
		),
	)
