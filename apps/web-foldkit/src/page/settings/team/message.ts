import { OrganizationMemberId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { TeamMember } from "./model"

export const Message = defineMessageUnion({
	UpdatedTeamMembers: { members: Schema.Array(TeamMember) },
	ClickedInviteUser: {},
	ClickedChangeRole: { memberId: OrganizationMemberId },
})
export type Message = typeof Message.Type
