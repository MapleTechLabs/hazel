import { CustomerAccountId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import {
	createFeatureFlagAction,
	deleteFeatureFlagAction,
	setFeatureFlagsAction,
} from "../../../../customers/actions"
import { settleFeatureFlags } from "../../../../customers/feature-flags"
import { Message } from "./message"

/** The feature flags page's Commands: create and delete a flag, assign it to customers or take it off. */

export const CreateFeatureFlag = Command.define("CreateFeatureFlag", {
	args: { organizationId: OrganizationId, key: Schema.String, createdBy: UserId },
	messages: [Message.SucceededFlagAction, Message.FailedFlagAction],
	execute: (args) =>
		createFeatureFlagAction(args).pipe(
			Effect.as(Message.SucceededFlagAction({ action: "create" })),
			settleFeatureFlags((failure) => Message.FailedFlagAction({ action: "create", failure })),
		),
})

export const DeleteFeatureFlag = Command.define("DeleteFeatureFlag", {
	args: { organizationId: OrganizationId, key: Schema.String },
	messages: [Message.SucceededFlagAction, Message.FailedFlagAction],
	execute: (args) =>
		deleteFeatureFlagAction(args).pipe(
			Effect.as(Message.SucceededFlagAction({ action: "delete" })),
			settleFeatureFlags((failure) => Message.FailedFlagAction({ action: "delete", failure })),
		),
})

export const SetFeatureFlagCustomers = Command.define("SetFeatureFlagCustomers", {
	args: {
		organizationId: OrganizationId,
		key: Schema.String,
		accountIds: Schema.Array(CustomerAccountId),
		enabled: Schema.Boolean,
	},
	messages: [Message.SucceededFlagAction, Message.FailedFlagAction],
	execute: ({ key, ...args }) => {
		const action = args.enabled ? "assign" : "unassign"
		return setFeatureFlagsAction({ ...args, keys: [key] }).pipe(
			Effect.as(Message.SucceededFlagAction({ action })),
			settleFeatureFlags((failure) => Message.FailedFlagAction({ action, failure })),
		)
	},
})
