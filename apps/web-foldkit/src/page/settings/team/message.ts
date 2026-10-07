import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { TeamMember } from "./model"

export const Message = defineMessageUnion({
	UpdatedTeamMembers: { members: Schema.Array(TeamMember) },
})
export type Message = typeof Message.Type
