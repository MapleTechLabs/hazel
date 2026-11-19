/**
 * What a new `CustomersObject` starts with: the settings row, one rule per signal template (its
 * defaults), the built-in list views and the built-in metric definitions. Installed once, on the
 * object's first activation (`./bootstrap.ts`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	BUILT_IN_METRICS,
	type BuiltInViewKey,
	DEFAULT_HEALTH_SETTINGS,
	DEFAULT_LIST_COLUMNS,
	SignalTemplate,
	TEMPLATES,
	type ViewFilters,
} from "@hazel/domain/customers"
import type { OrganizationId } from "@hazel/schema"
import { Effect } from "effect"
import { defaultLayoutRow } from "./layouts"

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
				format: metric.format,
				aggregation: metric.aggregation,
				builtIn: true,
			})),
		),
	)
	yield* db.run(
		SQLite.insertInto(schema.customerOverviewLayoutsTable).values(defaultLayoutRow(organizationId)),
	)
})

/**
 * Built-in definitions installed before they had a format read as plain numbers (MRR among them):
 * each takes its own. Idempotent; run on every activation.
 */
export const ensureBuiltInFormats = Effect.fn("Customers.ensureBuiltInFormats")(function* () {
	const db = yield* Database.Database
	for (const metric of BUILT_IN_METRICS) {
		yield* db.run(
			SQLite.update(schema.customerMetricDefinitionsTable)
				.set({ format: metric.format })
				.where(($) => [$.key.eq(metric.key), $.builtIn.eq(true), $.format.neq(metric.format)]),
		)
	}
})
