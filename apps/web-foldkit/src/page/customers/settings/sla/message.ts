import * as Customers from "@hazel/domain/customers"
import { CustomerSlaPolicyId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import * as Modal from "../../../../ui/modal"
import * as Select from "../../../../ui/select"
import { AccountOption, PolicyRow, SavedHours, SlaClock } from "./model"

/** A policy write's failure: the policy is gone, the store refused it, or a common reason. */
export const PolicyWriteFailure = Schema.Union([Schema.Literals(["NotFound", "Invalid"]), CommonReason])
export type PolicyWriteFailure = typeof PolicyWriteFailure.Type

export const Message = defineMessageUnion({
	UpdatedPolicies: { policies: Schema.Array(PolicyRow) },
	UpdatedSettings: { settings: Schema.NullOr(SavedHours) },
	UpdatedAccounts: { accounts: Schema.Array(AccountOption) },
	SucceededFetchPlans: { plans: Schema.Array(Schema.String) },
	FailedFetchPlans: { reason: CommonReason },
	PressedRetryPlans: {},
	GotSelectMessage: { selectId: Schema.String, message: Select.Message },

	// Business hours
	ToggledDay: { day: Schema.Int },
	ChangedStart: { value: Schema.String },
	ChangedEnd: { value: Schema.String },
	PressedSaveHours: {},
	PressedResetHours: {},
	SucceededSaveHours: {},
	FailedSaveHours: { reason: CommonReason },

	// The list
	ToggledPolicy: { policyId: CustomerSlaPolicyId, enabled: Schema.Boolean },
	SucceededTogglePolicy: {},
	FailedTogglePolicy: { reason: PolicyWriteFailure },
	PressedMove: { policyId: CustomerSlaPolicyId, offset: Schema.Literals([-1, 1]) },
	SucceededReorder: {},
	FailedReorder: { reason: PolicyWriteFailure },
	PressedDelete: { policyId: CustomerSlaPolicyId },
	GotDeleteModalMessage: { message: Modal.Message },
	PressedConfirmDelete: {},
	SucceededDeletePolicy: {},
	FailedDeletePolicy: { reason: PolicyWriteFailure },

	// The editor
	PressedNewPolicy: {},
	PressedEdit: { policyId: CustomerSlaPolicyId },
	PressedCloseEditor: {},
	ChangedName: { value: Schema.String },
	ToggledEnabled: { enabled: Schema.Boolean },
	ClickedHours: { hours: Customers.SlaHours },
	ToggledPlan: { plan: Schema.String },
	ChangedTagInput: { value: Schema.String },
	PressedAddTag: {},
	RemovedTag: { tag: Schema.String },
	ChangedAccountSearch: { value: Schema.String },
	ClearedAccountSearch: {},
	AddedAccount: { accountId: Schema.String },
	RemovedAccount: { accountId: Schema.String },
	ChangedTargetAmount: { priority: Customers.SlaPriority, clock: SlaClock, value: Schema.String },
	PressedSavePolicy: {},
	/** `token` names the editor the save was pressed in. */
	SucceededSavePolicy: { token: Schema.Int, isNew: Schema.Boolean },
	FailedSavePolicy: { token: Schema.Int, reason: PolicyWriteFailure },
})
export type Message = typeof Message.Type
