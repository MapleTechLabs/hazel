import {
	type MetricDefinition,
	type RuleDraft,
	type RuleDryRunResult,
	type RuleMatch,
	type SignalRule,
	TEMPLATES,
} from "@hazel/domain/customers"
import { CustomerMetricDefinitionId, type CustomerSignalRuleId } from "@hazel/schema"
import { Schema } from "effect"
import { ACCOUNTS, CONNECTIONS, CURRENCY, NOW, ORGANIZATION_ID, RULES, SIGNAL_ENTRIES } from "./customers"

/**
 * The signals settings lab's data beyond `customers.ts`: the metric definitions a usage rule can
 * watch, rules with scopes, and a `customers.rule.dryRun` answer for any draft, built from the
 * fixture signals of its template.
 */

const DAY = 86_400_000

const metricId = (n: number) =>
	Schema.decodeSync(CustomerMetricDefinitionId)(`00000030-0000-4000-8000-${String(n).padStart(12, "0")}`)

const metric = (
	n: number,
	fields: Pick<MetricDefinition, "key" | "name" | "unit" | "provider" | "description" | "builtIn">,
): MetricDefinition => ({
	id: metricId(n),
	organizationId: ORGANIZATION_ID,
	aggregation: fields.builtIn ? "max" : "sum",
	createdAt: new Date(NOW.getTime() - 120 * DAY),
	updatedAt: new Date(NOW.getTime() - 120 * DAY),
	...fields,
})

export const METRIC_DEFINITIONS: ReadonlyArray<MetricDefinition> = [
	metric(1, {
		key: "active_users",
		name: "Active users",
		unit: "users",
		provider: null,
		description: "Distinct contacts active per day",
		builtIn: true,
	}),
	metric(2, {
		key: "product_events",
		name: "Product events",
		unit: null,
		provider: "maple",
		description: "All tracked events per day",
		builtIn: false,
	}),
	metric(3, {
		key: "dashboards_created",
		name: "Dashboards created",
		unit: null,
		provider: "maple",
		description: "Custom metric",
		builtIn: false,
	}),
	metric(4, {
		key: "seats",
		name: "Metered feature usage",
		unit: null,
		provider: "autumn",
		description: "Seats, credits and limits per plan",
		builtIn: false,
	}),
]

/** The fixture rules, the first two with the scopes the Wonder rows show. */
export const SCOPED_RULES: ReadonlyArray<SignalRule> = RULES.map((rule) =>
	rule.template === "inactive"
		? { ...rule, name: "Stopped logging in", scope: { lifecycleStages: ["active"], minMrrMinor: 10_000 } }
		: rule.template === "usage_drop"
			? { ...rule, scope: { payingOnly: true } }
			: rule.template === "payment_failed"
				? rule
				: { ...rule, scope: rule.kind === "risk" ? { payingOnly: true } : rule.scope },
)

/** The fixture rule of `template` (`RULES` has one per template). */
export const ruleOf = (template: SignalRule["template"]): SignalRule => {
	const rule = SCOPED_RULES.find((each) => each.template === template)
	if (rule === undefined) throw new Error(`No fixture rule for ${template}`)
	return rule
}

const connected = new Set(
	CONNECTIONS.filter((row) => row.status !== "disconnected").map((row) => row.provider),
)

/** The dry run of `draft`: its template's fixture signals as matches, the other accounts explained. */
export const dryRunOf = (draft: RuleDraft, ruleId: CustomerSignalRuleId | null): RuleDryRunResult => {
	const template = draft.config._tag
	const required = TEMPLATES[template].requiredSources
	const missing = required.length > 0 && !required.some((provider) => connected.has(provider))
	const matches: ReadonlyArray<RuleMatch> = missing
		? []
		: SIGNAL_ENTRIES.filter(
				({ signal }) =>
					signal.template === template && (signal.status === "open" || signal.status === "snoozed"),
			).map(({ signal, account }) => ({
				accountId: account.id,
				name: account.name,
				logoUrl: account.logoUrl,
				mrrMinor: account.mrrMinor,
				severity: signal.severity,
				title: draft.name,
				reason: signal.reason,
				evidence: signal.evidence,
			}))
	const others = ACCOUNTS.length - matches.length
	const outOfScope = Object.keys(draft.scope).length === 0 ? 0 : Math.round(others * 0.35)
	const churned = ACCOUNTS.filter((account) => account.lifecycleStage === "churned").length
	return {
		matchCount: matches.length,
		mrrMinor: matches.reduce((sum, match) => sum + match.mrrMinor, 0),
		currency: CURRENCY,
		topMatches: matches.slice(0, 10),
		nonMatches: missing
			? [{ reason: "Missing data source", count: others }]
			: [
					{ reason: "Below threshold", count: others - outOfScope - churned },
					...(outOfScope === 0 ? [] : [{ reason: "Out of scope", count: outOfScope }]),
					{ reason: "Churned", count: churned },
				],
		queueDelta:
			ruleId === null
				? { opens: matches.length, resolves: 0, stays: 0 }
				: { opens: Math.min(2, matches.length), resolves: 0, stays: Math.max(0, matches.length - 2) },
		missingSources: missing ? [...required] : [],
	}
}
