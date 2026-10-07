import { ChannelId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../ui/aria/interaction"
import * as Menu from "../../ui/menu"
import { ToastRequest } from "../../overlay/toasts"
import { DirectoryMember } from "./model"

export const Message = defineMessageUnion({
	UpdatedMembers: { members: Schema.Array(DirectoryMember) },
	ChangedSearch: { value: Schema.String },
	ClearedSearch: {},
	PressedClearSearch: {},
	CompletedFocusSearch: {},
	PressedMessageMember: { userId: UserId, name: Schema.String },
	GotInteractionMessage: { message: Interaction.Message },
	GotMemberMenuMessage: { userId: UserId, message: Menu.Message },
	FoundExistingDm: { channelId: ChannelId },
	FoundNoDm: { userId: UserId, name: Schema.String },
	SucceededCreateDm: { channelId: ChannelId, name: Schema.String },
	FailedCreateDm: { toast: ToastRequest },
	SucceededCopyEmail: { email: Schema.String },
	FailedCopyEmail: {},
})
export type Message = typeof Message.Type
