import { InvitationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import * as Menu from "../../../ui/menu"
import { Invitation, RevokeFailure } from "./model"

export const Message = defineMessageUnion({
	SucceededFetchInvitations: { version: Schema.Number, invitations: Schema.Array(Invitation) },
	FailedFetchInvitations: { version: Schema.Number, reason: CommonReason },
	ClickedRetryFetchInvitations: {},
	ClickedInviteUser: {},
	GotRowMenuMessage: { invitationId: InvitationId, message: Menu.Message },
	SucceededRevokeInvitation: {},
	FailedRevokeInvitation: { reason: RevokeFailure },
})
export type Message = typeof Message.Type
