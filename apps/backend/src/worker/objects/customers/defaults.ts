/**
 * What a new `CustomersObject` starts with: the settings row, one rule per signal template (its
 * defaults), the built-in list views and the built-in metric definitions. Installed once, on the
 * object's first activation (`./bootstrap.ts`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	type BuiltInViewKey,
	DEFAULT_HEALTH_SETTINGS,
	DEFAULT_LIST_COLUMNS,
	SignalTemplate,
	TEMPLATES,
	type ViewFilters,
} from "@hazel/domain/customers"
import type { OrganizationId } from "@hazel/schema"
import { Effect } from "effect"

/** Metric keys Hazel computes; sources may not write them. */
export const BUILT_IN_METRICS = [
	{ key: "active_users", name: "Daily active users", unit: "users", aggregation: "max" },
	{ key: "active_users_30d", name: "Active users (30 days)", unit: "users", aggregation: "last" },
	{ key: "mrr", name: "MRR", unit: "minor", aggregation: "last" },
	{ key: "health_score", name: "Health score", unit: "points", aggregation: "last" },
] as const

export const isBuiltInMetric = (key: string) => BUILT_IN_METRICS.some((metric) => metric.key === key)

export const BUILT_IN_VIEWS: ReadonlyArray<{
	readonly key: BuiltInViewKey
	readonly name: string
	readonly filters: ViewFilters
}> = [
	{ key: "my_customers", name: "My customers", filters: { ownedByMe: true } },
	{ key: "paying", name: "Paying", filters: { payingOnly: true } },
	{ key: "trialing", name: "Trialing", filters: { lifecycleStages: ["trialing"] } },
	{ key: "at_risk", name: "At risk", filters: { healthStatuses: ["at_risk", "critical"] } },
	{ key: "churned", name: "Churned", filters: { lifecycleStages: ["churned"] } },
]

export const installDefaults = Effect.fn("Customers.installDefaults")(function* (
	organizationId: OrganizationId,
) {
	const db = yield* Database.Database
	yield* db.run(
		SQLite.insertInto(schema.customerSettingsTable).values({
			organizationId,
			health: DEFAULT_HEALTH_SETTINGS,
			reportingCurrency: "usd",
		}),
	)
	yield* db.run(
		SQLite.insertInto(schema.customerSignalRulesTable).values(
			SignalTemplate.literals.map((template) => {
				const meta = TEMPLATES[template]
				return {
					organizationId,
					name: meta.name,
					template,
					kind: meta.kind,
					severity: meta.defaultSeverity,
					config: meta.defaultConfig,
					scope: {},
					enabled: true,
				}
			}),
		),
	)
	yield* db.run(
		SQLite.insertInto(schema.customerSavedViewsTable).values(
			BUILT_IN_VIEWS.map((view, position) => ({
				organizationId,
				name: view.name,
				builtInKey: view.key,
				filters: view.filters,
				sort: { column: "mrr" as const, direction: "desc" as const },
				columns: DEFAULT_LIST_COLUMNS,
				position,
			})),
		),
	)
	yield* db.run(
		SQLite.insertInto(schema.customerMetricDefinitionsTable).values(
			BUILT_IN_METRICS.map((metric) => ({
				organizationId,
				key: metric.key,
				name: metric.name,
				unit: metric.unit,
				aggregation: metric.aggregation,
				builtIn: true,
			})),
		),
	)
})
