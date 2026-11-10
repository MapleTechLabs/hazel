import type * as Customers from "@hazel/domain/customers"
import type { OrganizationId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import type { Stream } from "effect"
import { customerMetricDefinitionCollection, customerSignalRuleCollection } from "~/db/collections"
import { msOf, withCustomersSource } from "../../../../customers/queries"
import { liveQueryStream } from "../../../../data/live-query"
import type { MetricRow, RuleRow } from "./model"

/** The page's own live queries over the `customers:<org>` collections: the rules and the metrics. */

const toRuleRow = (rule: Customers.SignalRule): RuleRow => ({
	id: rule.id,
	name: rule.name,
	template: rule.template,
	kind: rule.kind,
	severity: rule.severity,
	config: rule.config,
	scope: rule.scope,
	enabled: rule.enabled,
	lastTriggeredAtMs: rule.lastTriggeredAt === null ? null : msOf(rule.lastTriggeredAt),
	matchingCount: rule.matchingCount,
	updatedAtMs: msOf(rule.updatedAt),
})

/** The org's live (not deleted) rules, oldest first. */
export const rulesStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (rules: ReadonlyArray<RuleRow>) => Message,
): Stream.Stream<Message> =>
	withCustomersSource(
		organizationId,
		liveQueryStream<Customers.SignalRule, Message>(
			(q) =>
				q
					.from({ rule: customerSignalRuleCollection })
					.where(({ rule }) => and(eq(rule.organizationId, organizationId), isNull(rule.deletedAt)))
					.orderBy(({ rule }) => rule.createdAt, "asc"),
			(rows) => toMessage(rows.map(toRuleRow)),
		),
	)

/** Every metric a rule can watch: built in first, then by name. */
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
					[...rows]
						.sort((left, right) => Number(right.builtIn) - Number(left.builtIn))
						.map((row) => ({
							key: row.key,
							name: row.name,
							unit: row.unit,
							provider: row.provider,
							description: row.description,
						})),
				),
		),
	)
