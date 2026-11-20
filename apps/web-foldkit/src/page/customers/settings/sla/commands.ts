import * as Customers from "@hazel/domain/customers"
import { CustomerSettingsId, CustomerSlaPolicyId, OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { customerSlaPolicyCollection } from "~/db/collections"
import { catchCommon } from "../../../../data/actions"
import { HazelRpc } from "../../../../rpc"
import {
	deletePolicyAction,
	reorderPoliciesAction,
	saveBusinessHoursAction,
	updatePolicyAction,
} from "./actions"
import { Message } from "./message"

/** The SLA page's Commands: the plan names, policy writes, and the business hours. */

const target = { organizationId: OrganizationId, policyId: CustomerSlaPolicyId }

export const FetchSlaPlans = Command.define("FetchSlaPlans", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededFetchPlans, Message.FailedFetchPlans],
	execute: ({ organizationId }) =>
		HazelRpc.use((rpc) => rpc("customers.plans.list", { organizationId })).pipe(
			Effect.map(({ plans }) => Message.SucceededFetchPlans({ plans })),
			catchCommon((reason) => Message.FailedFetchPlans({ reason })),
		),
})

/** The list's switch: the saved policy with `enabled` flipped. */
export const ToggleSlaPolicy = Command.define("ToggleSlaPolicy", {
	args: { ...target, policy: Customers.SlaPolicyDraft },
	messages: [Message.SucceededTogglePolicy, Message.FailedTogglePolicy],
	execute: (args) =>
		updatePolicyAction(args).pipe(
			Effect.as(Message.SucceededTogglePolicy()),
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(Message.FailedTogglePolicy({ reason: "NotFound" })),
			),
			catchCommon((reason) => Message.FailedTogglePolicy({ reason })),
		),
})

/** A new policy, last in the order; waits (best effort) until its row has synced. */
export const CreateSlaPolicy = Command.define("CreateSlaPolicy", {
	args: { organizationId: OrganizationId, policy: Customers.SlaPolicyDraft },
	messages: [Message.SucceededSavePolicy, Message.FailedSavePolicy],
	execute: ({ organizationId, policy }) =>
		HazelRpc.use((rpc) => rpc("customers.slaPolicy.create", { organizationId, policy })).pipe(
			Effect.tap((result) =>
				Effect.ignore(customerSlaPolicyCollection.utils.awaitSeqEffect(result.transactionId)),
			),
			Effect.as(Message.SucceededSavePolicy()),
			catchCommon((reason) => Message.FailedSavePolicy({ reason })),
		),
})

export const UpdateSlaPolicy = Command.define("UpdateSlaPolicy", {
	args: { ...target, policy: Customers.SlaPolicyDraft },
	messages: [Message.SucceededSavePolicy, Message.FailedSavePolicy],
	execute: (args) =>
		updatePolicyAction(args).pipe(
			Effect.as(Message.SucceededSavePolicy()),
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(Message.FailedSavePolicy({ reason: "NotFound" })),
			),
			catchCommon((reason) => Message.FailedSavePolicy({ reason })),
		),
})

export const DeleteSlaPolicy = Command.define("DeleteSlaPolicy", {
	args: target,
	messages: [Message.SucceededDeletePolicy, Message.FailedDeletePolicy],
	execute: (args) =>
		deletePolicyAction(args).pipe(
			Effect.as(Message.SucceededDeletePolicy()),
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(Message.FailedDeletePolicy({ reason: "NotFound" })),
			),
			catchCommon((reason) => Message.FailedDeletePolicy({ reason })),
		),
})

export const ReorderSlaPolicies = Command.define("ReorderSlaPolicies", {
	args: { organizationId: OrganizationId, policyIds: Schema.Array(CustomerSlaPolicyId) },
	messages: [Message.SucceededReorder, Message.FailedReorder],
	execute: (args) =>
		reorderPoliciesAction(args).pipe(
			Effect.as(Message.SucceededReorder()),
			Effect.catchTag("CustomersInvalidRequestError", () =>
				Effect.succeed(Message.FailedReorder({ reason: "Invalid" })),
			),
			catchCommon((reason) => Message.FailedReorder({ reason })),
		),
})

export const SaveBusinessHours = Command.define("SaveBusinessHours", {
	args: {
		organizationId: OrganizationId,
		settingsId: CustomerSettingsId,
		businessHours: Customers.BusinessHours,
	},
	messages: [Message.SucceededSaveHours, Message.FailedSaveHours],
	execute: (args) =>
		saveBusinessHoursAction(args).pipe(
			Effect.as(Message.SucceededSaveHours()),
			catchCommon((reason) => Message.FailedSaveHours({ reason })),
		),
})
