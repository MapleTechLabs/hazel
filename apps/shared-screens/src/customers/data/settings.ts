/**
 * The Customers settings pages' data (Plans, Support SLAs): the org's settings row and SLA policies
 * as live queries, and their optimistic writes (the row changes at once, the RPC runs, the
 * `customers:<org>` transaction is awaited, a failure rolls the row back).
 */
import { HazelRpc, liveQueryStream } from "@hazel/client-data"
import * as Customers from "@hazel/domain/customers"
import { CustomerSettingsId, CustomerSlaPolicyId, type OrganizationId } from "@hazel/schema"
import { optimisticAction } from "@hazel/effect-db-collection"
import { and, eq, isNull } from "@tanstack/db"
import { Effect, Schema, type Stream } from "effect"
import { type CustomersData, withCustomersSourceIn } from "./queries"

// ROWS

/** The settings row as the settings pages keep it. */
export const SettingsRow = Schema.Struct({
	id: CustomerSettingsId,
	addOnPlans: Schema.Array(Schema.String),
	businessHours: Customers.BusinessHours,
	supportTriage: Customers.SupportTriageSettings,
})
export type SettingsRow = typeof SettingsRow.Type

/** A live policy as the SLA page keeps it. */
export const PolicyRow = Schema.Struct({
	id: CustomerSlaPolicyId,
	name: Schema.String,
	position: Schema.Int,
	enabled: Schema.Boolean,
	appliesTo: Customers.SlaAppliesTo,
	targets: Customers.SlaTargets,
	hours: Customers.SlaHours,
	warnBeforePct: Schema.Int,
})
export type PolicyRow = typeof PolicyRow.Type

const toPolicyRow = (policy: Customers.SlaPolicy): PolicyRow => ({
	id: policy.id,
	name: policy.name,
	position: policy.position,
	enabled: policy.enabled,
	appliesTo: policy.appliesTo,
	targets: policy.targets,
	hours: policy.hours,
	warnBeforePct: policy.warnBeforePct,
})

/** What one settings save changes. */
export interface SettingsChange {
	readonly addOnPlans?: ReadonlyArray<string>
	readonly supportTriage?: Customers.SupportTriageSettings
}

interface SettingsTarget {
	readonly organizationId: OrganizationId
	readonly settingsId: CustomerSettingsId
}

interface PolicyTarget {
	readonly organizationId: OrganizationId
	readonly policyId: CustomerSlaPolicyId
}

export const makeSettingsData = (data: CustomersData) => {
	const { customerSettingsCollection, customerSlaPolicyCollection } = data.collections
	const withCustomersSource = withCustomersSourceIn(data)

	// QUERIES

	/** The org's settings row; null until the object has seeded it. */
	const settingsStream = <Message>(
		organizationId: OrganizationId,
		toMessage: (settings: SettingsRow | null) => Message,
	): Stream.Stream<Message> =>
		withCustomersSource(
			organizationId,
			liveQueryStream<Customers.Settings, Message>(
				(q) =>
					q
						.from({ settings: customerSettingsCollection })
						.where(({ settings }) => eq(settings.organizationId, organizationId))
						.findOne(),
				(rows) => {
					const row = rows[0]
					return toMessage(
						row === undefined
							? null
							: {
									id: row.id,
									addOnPlans: row.addOnPlans,
									businessHours: row.businessHours,
									supportTriage: row.supportTriage,
								},
					)
				},
			),
		)

	/** The org's live (not deleted) policies, first match first. */
	const policiesStream = <Message>(
		organizationId: OrganizationId,
		toMessage: (policies: ReadonlyArray<PolicyRow>) => Message,
	): Stream.Stream<Message> =>
		withCustomersSource(
			organizationId,
			liveQueryStream<Customers.SlaPolicy, Message>(
				(q) =>
					q
						.from({ policy: customerSlaPolicyCollection })
						.where(({ policy }) =>
							and(eq(policy.organizationId, organizationId), isNull(policy.deletedAt)),
						)
						.orderBy(({ policy }) => policy.position, "asc"),
				(rows) => toMessage(rows.map(toPolicyRow)),
			),
		)

	// WRITES

	/** Add-on plans or triage; the server recomputes the accounts soon. */
	const saveSettingsAction = optimisticAction({
		collections: [customerSettingsCollection],
		onMutate: (props: SettingsTarget & { readonly change: SettingsChange }) => {
			customerSettingsCollection.update(props.settingsId, (row) => {
				Object.assign(row, props.change)
			})
			return { settingsId: props.settingsId }
		},
		mutate: (props) =>
			Effect.gen(function* () {
				const client = yield* HazelRpc
				const result = yield* client("customers.settings.update", {
					organizationId: props.organizationId,
					...props.change,
				})
				return { data: result, transactionId: result.transactionId }
			}),
	})

	const saveBusinessHoursAction = optimisticAction({
		collections: [customerSettingsCollection],
		onMutate: (props: SettingsTarget & { readonly businessHours: Customers.BusinessHours }) => {
			customerSettingsCollection.update(props.settingsId, (row) => {
				Object.assign(row, { businessHours: props.businessHours })
			})
			return { settingsId: props.settingsId }
		},
		mutate: (props) =>
			Effect.gen(function* () {
				const client = yield* HazelRpc
				const result = yield* client("customers.businessHours.update", {
					organizationId: props.organizationId,
					businessHours: props.businessHours,
				})
				return { data: result, transactionId: result.transactionId }
			}),
	})

	/** Replaces the policy's settings with `policy` (the list's switch sends the saved one, `enabled` flipped). */
	const updatePolicyAction = optimisticAction({
		collections: [customerSlaPolicyCollection],
		onMutate: (props: PolicyTarget & { readonly policy: Customers.SlaPolicyDraft }) => {
			customerSlaPolicyCollection.update(props.policyId, (row) => {
				row.name = props.policy.name
				row.enabled = props.policy.enabled
				// Copies: the draft's arrays are readonly, the row's own are not.
				row.appliesTo = structuredClone(props.policy.appliesTo) as typeof row.appliesTo
				row.targets = structuredClone(props.policy.targets)
				row.hours = props.policy.hours
				row.warnBeforePct = props.policy.warnBeforePct
			})
			return { policyId: props.policyId }
		},
		mutate: (props) =>
			Effect.gen(function* () {
				const client = yield* HazelRpc
				const result = yield* client("customers.slaPolicy.update", {
					organizationId: props.organizationId,
					policyId: props.policyId,
					policy: props.policy,
				})
				return { data: result.data, transactionId: result.transactionId }
			}),
	})

	/** A new policy, last in the order; waits (best effort) until its row has synced. */
	const createPolicyAction = (props: {
		readonly organizationId: OrganizationId
		readonly policy: Customers.SlaPolicyDraft
	}) =>
		HazelRpc.use((rpc) => rpc("customers.slaPolicy.create", props)).pipe(
			Effect.tap((result) =>
				Effect.ignore(customerSlaPolicyCollection.utils.awaitSeqEffect(result.transactionId)),
			),
		)

	const deletePolicyAction = optimisticAction({
		collections: [customerSlaPolicyCollection],
		onMutate: (props: PolicyTarget) => {
			customerSlaPolicyCollection.delete(props.policyId)
			return { policyId: props.policyId }
		},
		mutate: (props) =>
			Effect.gen(function* () {
				const client = yield* HazelRpc
				const result = yield* client("customers.slaPolicy.delete", {
					organizationId: props.organizationId,
					policyId: props.policyId,
				})
				return { data: result, transactionId: result.transactionId }
			}),
	})

	/** The whole order, first match first: each row takes its index as its position. */
	const reorderPoliciesAction = optimisticAction({
		collections: [customerSlaPolicyCollection],
		onMutate: (props: {
			readonly organizationId: OrganizationId
			readonly policyIds: ReadonlyArray<CustomerSlaPolicyId>
		}) => {
			props.policyIds.forEach((policyId, position) => {
				customerSlaPolicyCollection.update(policyId, (row) => {
					row.position = position
				})
			})
			return { policyIds: props.policyIds }
		},
		mutate: (props) =>
			Effect.gen(function* () {
				const client = yield* HazelRpc
				const result = yield* client("customers.slaPolicy.reorder", {
					organizationId: props.organizationId,
					policyIds: props.policyIds,
				})
				return { data: result, transactionId: result.transactionId }
			}),
	})

	return {
		settingsStream,
		policiesStream,
		saveSettingsAction,
		saveBusinessHoursAction,
		updatePolicyAction,
		createPolicyAction,
		deletePolicyAction,
		reorderPoliciesAction,
	}
}
