import type { RuleDraft } from "@hazel/domain/customers"
import type { CustomerSignalRuleId, OrganizationId } from "@hazel/schema"
import { optimisticAction } from "@hazel/effect-db-collection"
import { Effect } from "effect"
import { customerSignalRuleCollection } from "~/db/collections"
import { HazelRpc } from "../../../../rpc"

/**
 * The rules' optimistic writes: the row changes in the collection at once, the RPC runs, the
 * `customers:<org>` transaction is awaited, and a failure rolls the row back.
 */

interface RuleTarget {
	readonly organizationId: OrganizationId
	readonly ruleId: CustomerSignalRuleId
}

/** Replaces the rule's settings with `rule` (the list's switch sends the saved rule, `enabled` flipped). */
export const updateRuleAction = optimisticAction({
	collections: [customerSignalRuleCollection],
	onMutate: (props: RuleTarget & { readonly rule: RuleDraft }) => {
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
export const deleteRuleAction = optimisticAction({
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
