import { CustomerAccountId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { FeatureFlagFailure } from "../../../../customers/feature-flags"
import { AccountRow } from "../../../../customers/queries"
import * as Modal from "../../../../ui/modal"
import * as Popover from "../../../../ui/popover"

export const FlagAction = Schema.Literals(["create", "delete", "assign", "unassign"])
export type FlagAction = typeof FlagAction.Type

export const Message = defineMessageUnion({
	UpdatedCreated: { keys: Schema.Array(Schema.String) },
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	PressedFlag: { key: Schema.String },
	ChangedNewKey: { value: Schema.String },
	SubmittedNewKey: {},

	PressedDeleteFlag: { key: Schema.String },
	GotDeleteModalMessage: { message: Modal.Message },
	PressedConfirmDelete: {},

	GotCustomerPopoverMessage: { message: Popover.Message },
	ChangedCustomerSearch: { value: Schema.String },
	ToggledCustomer: { accountId: CustomerAccountId, isSelected: Schema.Boolean },
	PressedAddCustomers: {},
	PressedRemoveCustomer: { accountId: CustomerAccountId },

	SucceededFlagAction: { action: FlagAction },
	FailedFlagAction: { action: FlagAction, failure: FeatureFlagFailure },
})
export type Message = typeof Message.Type
