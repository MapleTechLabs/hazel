import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Menu from "../../../ui/menu"
import { Invitation } from "./model"

export const Message = defineMessageUnion({
	CompletedFetchInvitations: { version: Schema.Number, invitations: Schema.Array(Invitation) },
	ClickedInviteUser: {},
	GotRowMenuMessage: { invitationId: Schema.String, message: Menu.Message },
	SucceededRevokeInvitation: {},
	FailedRevokeInvitation: {},
})
export type Message = typeof Message.Type
