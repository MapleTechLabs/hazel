import * as Customers from "@hazel/domain/customers"
import { CustomerSignalRuleId, OrganizationId } from "@hazel/schema"
import { Duration, Effect, Schema } from "effect"
import { Command } from "foldkit"
import { customerSignalRuleCollection } from "~/db/collections"
import { catchCommon } from "../../../../data/actions"
import { HazelRpc } from "../../../../rpc"
import { deleteRuleAction, updateRuleAction } from "./actions"
import { Message } from "./message"
import { DRY_RUN_DEBOUNCE_MS } from "./model"

/** The signals page's Commands: rule writes, and the debounced dry run behind the live preview. */

const target = { organizationId: OrganizationId, ruleId: CustomerSignalRuleId }

/** The list's switch: the saved rule with `enabled` flipped. */
export const ToggleSignalRule = Command.define("ToggleSignalRule", {
	args: { ...target, rule: Customers.RuleDraft },
	messages: [Message.SucceededToggleRule, Message.FailedToggleRule],
	execute: ({ organizationId, ruleId, rule }) => {
		const failed = (reason: "NotFound" | "Invalid") =>
			Effect.succeed(Message.FailedToggleRule({ ruleId, enabled: rule.enabled, reason }))
		return updateRuleAction({ organizationId, ruleId, rule }).pipe(
			Effect.as(Message.SucceededToggleRule({ ruleId })),
			Effect.catchTags({
				CustomersNotFoundError: () => failed("NotFound"),
				CustomersInvalidRequestError: () => failed("Invalid"),
			}),
			catchCommon((reason) => Message.FailedToggleRule({ ruleId, enabled: rule.enabled, reason })),
		)
	},
})

/**
 * A new rule. The editor then opens it by id, so this waits until its row has synced; the wait is
 * best effort (the rule exists either way, and the editor shows it once it arrives).
 */
export const CreateSignalRule = Command.define("CreateSignalRule", {
	args: { organizationId: OrganizationId, rule: Customers.RuleDraft },
	messages: [Message.SucceededCreateRule, Message.FailedCreateRule],
	execute: ({ organizationId, rule }) =>
		HazelRpc.use((rpc) => rpc("customers.rule.create", { organizationId, rule })).pipe(
			Effect.tap((result) =>
				Effect.ignore(customerSignalRuleCollection.utils.awaitSeqEffect(result.transactionId)),
			),
			Effect.map((result) => Message.SucceededCreateRule({ ruleId: result.data.id })),
			Effect.catchTag("CustomersInvalidRequestError", () =>
				Effect.succeed(Message.FailedCreateRule({ reason: "Invalid" })),
			),
			catchCommon((reason) => Message.FailedCreateRule({ reason })),
		),
})

export const UpdateSignalRule = Command.define("UpdateSignalRule", {
	args: { ...target, rule: Customers.RuleDraft },
	messages: [Message.SucceededUpdateRule, Message.FailedUpdateRule],
	execute: ({ organizationId, ruleId, rule }) =>
		updateRuleAction({ organizationId, ruleId, rule }).pipe(
			Effect.as(Message.SucceededUpdateRule({ ruleId })),
			Effect.catchTags({
				CustomersNotFoundError: () =>
					Effect.succeed(Message.FailedUpdateRule({ ruleId, reason: "NotFound" })),
				CustomersInvalidRequestError: () =>
					Effect.succeed(Message.FailedUpdateRule({ ruleId, reason: "Invalid" })),
			}),
			catchCommon((reason) => Message.FailedUpdateRule({ ruleId, reason })),
		),
})

export const DeleteSignalRule = Command.define("DeleteSignalRule", {
	args: target,
	messages: [Message.SucceededDeleteRule, Message.FailedDeleteRule],
	execute: ({ organizationId, ruleId }) =>
		deleteRuleAction({ organizationId, ruleId }).pipe(
			Effect.as(Message.SucceededDeleteRule({ ruleId })),
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(Message.FailedDeleteRule({ ruleId, reason: "NotFound" })),
			),
			catchCommon((reason) => Message.FailedDeleteRule({ ruleId, reason })),
		),
})

/** The pause after an edit before the preview reruns; a later edit's version supersedes it. */
export const WaitForRuleDryRunDelay = Command.define("WaitForRuleDryRunDelay", {
	args: { version: Schema.Int },
	messages: [Message.ElapsedRuleDryRunDelay],
	execute: ({ version }) =>
		Effect.sleep(Duration.millis(DRY_RUN_DEBOUNCE_MS)).pipe(
			Effect.as(Message.ElapsedRuleDryRunDelay({ version })),
		),
})

interface DryRunPayload {
	organizationId: OrganizationId
	draft: Customers.RuleDraft
	ruleId?: CustomerSignalRuleId
}

/** The draft evaluated over today's data; `ruleId` compares it with that rule's signals. */
export const FetchRuleDryRun = Command.define("FetchRuleDryRun", {
	args: {
		organizationId: OrganizationId,
		version: Schema.Int,
		draft: Customers.RuleDraft,
		ruleId: Schema.NullOr(CustomerSignalRuleId),
	},
	messages: [Message.SucceededFetchDryRun, Message.FailedFetchDryRun],
	execute: ({ organizationId, version, draft, ruleId }) => {
		// `ruleId` is an optional key: absent for a new rule, never undefined.
		const payload: DryRunPayload = { organizationId, draft }
		if (ruleId !== null) payload.ruleId = ruleId
		return HazelRpc.use((rpc) => rpc("customers.rule.dryRun", payload)).pipe(
			Effect.map((result) => Message.SucceededFetchDryRun({ version, result })),
			catchCommon((reason) => Message.FailedFetchDryRun({ version, reason })),
		)
	},
})
