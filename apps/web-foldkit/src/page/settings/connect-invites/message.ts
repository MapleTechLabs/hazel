import { ConnectInviteId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { ToastRequest } from "../../../overlay/toasts"
import { HostOrganization, Invite } from "./model"

export const Message = defineMessageUnion({
	SucceededListInvites: { invites: Schema.Array(Invite) },
	FailedListInvites: {},
	UpdatedHostOrganizations: { organizations: Schema.Array(HostOrganization) },
	ClickedAccept: { inviteId: ConnectInviteId },
	SucceededAccept: { inviteId: ConnectInviteId },
	FailedAccept: { inviteId: ConnectInviteId, toast: ToastRequest },
	ClickedDecline: { inviteId: ConnectInviteId },
	SucceededDecline: { inviteId: ConnectInviteId },
	FailedDecline: { inviteId: ConnectInviteId, toast: ToastRequest },
})
export type Message = typeof Message.Type
