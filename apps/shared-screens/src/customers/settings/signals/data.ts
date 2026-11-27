// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What the Signals pages read and write: their live queries over the `customers:<org>` collections
 * (the rules, the metrics, who Needs attention covers, plus the shared accounts, signals, sources and
 * settings) and the rules' optimistic writes. The list page and the rule editor share both.
 */
import { type ClientData, HazelRpc, liveQueryStream } from "@hazel/client-data"
import type * as Customers from "@hazel/domain/customers"
import type { CustomerSettingsId, CustomerSignalRuleId, OrganizationId } from "@hazel/schema"
import { optimisticAction } from "@hazel/effect-db-collection"
import { and, eq, isNull } from "@tanstack/db"
import { Effect, Stream } from "effect"
import { withData } from "../../../app/live"
import { type CustomersData, makeCustomerQueries, msOf } from "../../data/queries"
import type { AccountRow, SettingsSummary, SignalRow } from "../../data/queries"
import type { AttentionRow, MetricRow, RuleRow } from "./model"

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

/** The page messages each live query answers with. */
export interface SignalsFeeds<Msg> {
	readonly rules: (rules: ReadonlyArray<RuleRow>) => Msg
	readonly signals: (signals: ReadonlyArray<SignalRow>) => Msg
	readonly accounts: (accounts: ReadonlyArray<AccountRow>) => Msg
	readonly providers: (providers: ReadonlyArray<Customers.CustomerProvider>) => Msg
	readonly settings: (settings: SettingsSummary | null) => Msg
	readonly metrics: (metrics: ReadonlyArray<MetricRow>) => Msg
	readonly attention?: (attention: AttentionRow | null) => Msg
}

const queriesOf = (data: CustomersData) => {
	const { customerSignalRuleCollection, customerMetricDefinitionCollection, customerSettingsCollection } =
		data.collections
	const shared = makeCustomerQueries(data)

	/** The org's live (not deleted) rules, oldest first. */
	const rulesStream = <Msg>(organizationId: OrganizationId, toMessage: SignalsFeeds<Msg>["rules"]) =>
		shared.withCustomersSource(
			organizationId,
			liveQueryStream<Customers.SignalRule, Msg>(
				(q) =>
					q
						.from({ rule: customerSignalRuleCollection })
						.where(({ rule }) =>
							and(eq(rule.organizationId, organizationId), isNull(rule.deletedAt)),
						)
						.orderBy(({ rule }) => rule.createdAt, "asc"),
				(rows) => toMessage(rows.map(toRuleRow)),
			),
		)

	/** Every metric a rule can watch: built in first, then by name. */
	const metricsStream = <Msg>(organizationId: OrganizationId, toMessage: SignalsFeeds<Msg>["metrics"]) =>
		shared.withCustomersSource(
			organizationId,
			liveQueryStream<Customers.MetricDefinition, Msg>(
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
								unit: row.customUnit ?? row.unit,
								provider: row.provider,
								description: row.description,
							})),
					),
			),
		)

	/** Who Needs attention covers; null until the object has seeded its settings row. */
	const attentionStream = <Msg>(
		organizationId: OrganizationId,
		toMessage: (row: AttentionRow | null) => Msg,
	) =>
		shared.withCustomersSource(
			organizationId,
			liveQueryStream<Customers.Settings, Msg>(
				(q) =>
					q
						.from({ settings: customerSettingsCollection })
						.where(({ settings }) => eq(settings.organizationId, organizationId))
						.findOne(),
				(rows) => {
					const row = rows[0]
					return toMessage(
						row === undefined ? null : { settingsId: row.id, attention: row.attention },
					)
				},
			),
		)

	return { ...shared, rulesStream, metricsStream, attentionStream }
}

/** One live query as a stream of page messages, over the app's data. */
export const signalsFeed = <Msg>(
	organizationId: OrganizationId,
	feed: keyof SignalsFeeds<Msg>,
	feeds: SignalsFeeds<Msg>,
): Stream.Stream<Msg, never, ClientData> =>
	withData((data) => {
		const queries = queriesOf(data)
		switch (feed) {
			case "rules":
				return queries.rulesStream(organizationId, feeds.rules)
			case "signals":
				return queries.signalsStream(organizationId, feeds.signals)
			case "accounts":
				return queries.accountsStream(organizationId, feeds.accounts)
			case "providers":
				return queries.connectedProvidersStream(organizationId, feeds.providers)
			case "settings":
				return queries.settingsSummaryStream(organizationId, feeds.settings)
			case "metrics":
				return queries.metricsStream(organizationId, feeds.metrics)
			case "attention":
				return feeds.attention === undefined
					? Stream.empty
					: queries.attentionStream(organizationId, feeds.attention)
		}
	})

// WRITES

interface RuleTarget {
	readonly organizationId: OrganizationId
	readonly ruleId: CustomerSignalRuleId
}

interface AttentionTarget {
	readonly organizationId: OrganizationId
	readonly settingsId: CustomerSettingsId
	readonly attention: Customers.AttentionSettings
}

/** The rules' optimistic writes over one client's collections: the row changes at once, a failure rolls it back. */
export const makeSignalRuleActions = (data: CustomersData) => {
	const { customerSignalRuleCollection, customerSettingsCollection } = data.collections

	/** Replaces the rule's settings with `rule` (the list's switch sends the saved rule, `enabled` flipped). */
	const updateRule = optimisticAction({
		collections: [customerSignalRuleCollection],
		onMutate: (props: RuleTarget & { readonly rule: Customers.RuleDraft }) => {
			customerSignalRuleCollection.update(props.ruleId, (row) => {
				row.name = props.rule.name
				row.severity = props.rule.severity
				// A copy: the draft's arrays are readonly, the row's own are not.
				row.config = structuredClone(props.rule.config) as typeof row.config
				row.scope = structuredClone(props.rule.scope) as typeof row.scope
				row.enabled = props.rule.enabled
			})
			return { ruleId: props.ruleId }
		},
		mutate: (props) =>
			Effect.gen(function* () {
				const client = yield* HazelRpc
				const result = yield* client("customers.rule.update", {
					organizationId: props.organizationId,
					ruleId: props.ruleId,
					rule: props.rule,
				})
				return { data: result.data, transactionId: result.transactionId }
			}),
	})

	/** Deletes the rule; its open signals close (`auto_resolved`) on the server. */
	const deleteRule = optimisticAction({
		collections: [customerSignalRuleCollection],
		onMutate: (props: RuleTarget) => {
			customerSignalRuleCollection.delete(props.ruleId)
			return { ruleId: props.ruleId }
		},
		mutate: (props) =>
			Effect.gen(function* () {
				const client = yield* HazelRpc
				const result = yield* client("customers.rule.delete", {
					organizationId: props.organizationId,
					ruleId: props.ruleId,
				})
				return { data: result, transactionId: result.transactionId }
			}),
	})

	/** A new rule, once its row has synced (best effort: the rule exists either way). */
	const createRule = (props: {
		readonly organizationId: OrganizationId
		readonly rule: Customers.RuleDraft
	}) =>
		HazelRpc.use((rpc) => rpc("customers.rule.create", props)).pipe(
			Effect.tap((result) =>
				Effect.ignore(customerSignalRuleCollection.utils.awaitSeqEffect(result.transactionId)),
			),
			Effect.map((result) => result.data.id),
		)

	/** Who Needs attention covers: the settings row takes it at once. */
	const saveAttention = optimisticAction({
		collections: [customerSettingsCollection],
		onMutate: (props: AttentionTarget) => {
			customerSettingsCollection.update(props.settingsId, (row) => {
				Object.assign(row, { attention: props.attention })
			})
			return { settingsId: props.settingsId }
		},
		mutate: (props) =>
			Effect.gen(function* () {
				const client = yield* HazelRpc
				const result = yield* client("customers.settings.update", {
					organizationId: props.organizationId,
					attention: props.attention,
				})
				return { data: result, transactionId: result.transactionId }
			}),
	})

	return { updateRule, deleteRule, createRule, saveAttention }
}
