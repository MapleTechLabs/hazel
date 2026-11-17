import { ChannelId, CustomerAccountId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../../ui/aria/interaction"
import { CommonReason } from "~/lib/error-messages"
import { ChannelCustomerRow } from "../../../customers/channels"
import * as Popover from "../../../ui/popover"
import { CustomerOption, UpdateChannelFailure } from "./model"

/** A refused link: the customer or channel is gone (`NotFound`), or the channel cannot be linked. */
export const CustomerLinkFailure = Schema.Union([Schema.Literals(["NotFound", "NotLinkable"]), CommonReason])
export type CustomerLinkFailure = typeof CustomerLinkFailure.Type

export const LoadedChannel = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	icon: Schema.NullOr(Schema.String),
})

export const Message = defineMessageUnion({
	UpdatedChannel: { channel: Schema.NullOr(LoadedChannel) },
	ChangedName: { name: Schema.String },
	ClearedIcon: {},
	SubmittedForm: {},
	SucceededUpdateChannel: {},
	FailedUpdateChannel: { reason: UpdateChannelFailure },
	GotInteractionMessage: { message: Interaction.Message },

	UpdatedCustomer: { customer: Schema.NullOr(ChannelCustomerRow) },
	UpdatedCustomers: { customers: Schema.Array(CustomerOption) },
	GotCustomerPopoverMessage: { message: Popover.Message },
	ChangedCustomerSearch: { value: Schema.String },
	PressedLinkCustomer: { accountId: CustomerAccountId },
	PressedUnlinkCustomer: {},
	SucceededCustomerLink: {},
	FailedCustomerLink: { unlinking: Schema.Boolean, reason: CustomerLinkFailure },
})
export type Message = typeof Message.Type
