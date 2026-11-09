import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../ui/aria/interaction"
import * as Menu from "../../ui/menu"
import { DirectoryMember, DmRow } from "./model"

export const Message = defineMessageUnion({
	UpdatedMembers: { members: Schema.Array(DirectoryMember) },
	ChangedSearch: { value: Schema.String },
	ClearedSearch: {},
	PressedClearSearch: {},
	CompletedFocusSearch: {},
	PressedMessageMember: { userId: UserId, name: Schema.String },
	GotInteractionMessage: { message: Interaction.Message },
	GotMemberMenuMessage: { userId: UserId, message: Menu.Message },
	UpdatedDmChannels: { rows: Schema.Array(DmRow) },
	SucceededCopyEmail: { email: Schema.String },
	FailedCopyEmail: {},
})
export type Message = typeof Message.Type
