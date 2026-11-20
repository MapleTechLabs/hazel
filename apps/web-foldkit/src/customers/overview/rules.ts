import type * as Customers from "@hazel/domain/customers"
import { Match } from "effect"
import { formatMetric, formatMoney } from "../format"
import { HEALTH_LABEL, STAGE_LABEL } from "../ui/badges"
import type { MetricDef } from "./rows"

/** How a layout's rule reads as chips: `Plan is Pro or Enterprise`, `Spans ingested 30d < 5 GB`. */

const list = (items: ReadonlyArray<string>): string =>
	items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`

export const conditionLabel = (
	condition: Customers.LayoutCondition,
	metrics: ReadonlyArray<MetricDef>,
	currency: string,
): string =>
	Match.valueTags(condition, {
		stage: ({ stages }) => `Stage is ${list(stages.map((stage) => STAGE_LABEL[stage]))}`,
		plan: ({ planNames }) => `Plan is ${list(planNames)}`,
		tag: ({ tags }) => `Tagged ${list(tags)}`,
		health: ({ statuses }) => `Health is ${list(statuses.map((status) => HEALTH_LABEL[status]))}`,
		mrr: ({ op, valueMinor }) => `MRR ${op === "gte" ? "≥" : "<"} ${formatMoney(valueMinor, currency)}`,
		attribute: ({ key, op, value }) =>
			op === "exists" ? `Has ${key}` : `${key} ${op === "eq" ? "is" : "is not"} ${value}`,
		metric: ({ metricKey, windowDays, op, value }) => {
			const metric = metrics.find((each) => each.key === metricKey)
			const text = formatMetric(value, metric ?? { format: "number", unit: null }, currency)
			return `${metric?.name ?? metricKey} ${windowDays}d ${op === "gt" ? ">" : "<"} ${text}`
		},
	})

/** One chip per condition; none: every customer. */
export const ruleChips = (
	rule: Customers.LayoutRule,
	metrics: ReadonlyArray<MetricDef>,
	currency: string,
): ReadonlyArray<string> => rule.conditions.map((condition) => conditionLabel(condition, metrics, currency))
