import type * as Customers from "@hazel/domain/customers"
import type { CustomerSettingsId, CustomerSlaPolicyId, OrganizationId } from "@hazel/schema"
import { optimisticAction } from "@hazel/effect-db-collection"
import { Effect } from "effect"
import { customerSettingsCollection, customerSlaPolicyCollection } from "~/db/collections"
import { HazelRpc } from "../../../../rpc"

/**
 * The policies' and business hours' optimistic writes: the row changes in the collection at once,
 * the RPC runs, the `customers:<org>` transaction is awaited, and a failure rolls the row back.
 */

interface PolicyTarget {
	readonly organizationId: OrganizationId
	readonly policyId: CustomerSlaPolicyId
}

/** Replaces the policy's settings with `policy` (the list's switch sends the saved one, `enabled` flipped). */
export const updatePolicyAction = optimisticAction({
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

export const deletePolicyAction = optimisticAction({
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
export const reorderPoliciesAction = optimisticAction({
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

export const saveBusinessHoursAction = optimisticAction({
	collections: [customerSettingsCollection],
	onMutate: (props: {
		readonly organizationId: OrganizationId
		readonly settingsId: CustomerSettingsId
		readonly businessHours: Customers.BusinessHours
	}) => {
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
