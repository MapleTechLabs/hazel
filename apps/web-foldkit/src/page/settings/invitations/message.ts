import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Menu from "../../../ui/menu"
import { Invitation } from "./model"

export const Message = defineMessageUnion({
	CompletedFetchInvitations: { invitations: Schema.Array(Invitation) },
	ClickedInviteUser: {},
	GotRowMenuMessage: { invitationId: Schema.String, message: Menu.Message },
	SucceededRevoke: {},
	FailedRevoke: {},
})
export type Message = typeof Message.Type
