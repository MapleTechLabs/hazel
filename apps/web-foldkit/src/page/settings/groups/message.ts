import { UserGroupId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as ConfirmAction from "../../shared/confirm-action"
import { Failure, Group, OrgMember } from "./model"

const failed = { reason: Failure, detail: Schema.NullOr(Schema.String) }

export const Message = defineMessageUnion({
	UpdatedGroups: { groups: Schema.Array(Group) },
	UpdatedMembers: { members: Schema.Array(OrgMember) },
	ClickedNewGroup: {},
	ChangedCreateName: { value: Schema.String },
	ChangedCreateHandle: { value: Schema.String },
	ClickedCancelCreate: {},
	ClickedCreateGroup: {},
	SucceededCreateGroup: { id: UserGroupId, handle: Schema.String, name: Schema.String },
	FailedCreateGroup: failed,
	ClickedGroup: { id: UserGroupId },
	ClickedCloseGroup: {},
	ChangedEditName: { value: Schema.String },
	ChangedEditHandle: { value: Schema.String },
	ClickedSaveGroup: {},
	SucceededSaveGroup: { handle: Schema.String },
	FailedSaveGroup: failed,
	ChangedMemberSearch: { value: Schema.String },
	ClickedAddMember: { userId: UserId },
	ClickedRemoveMember: { userId: UserId },
	SucceededChangeMembers: {},
	FailedChangeMembers: failed,
	ClickedDeleteGroup: { id: UserGroupId, handle: Schema.String },
	ClickedConfirmDelete: {},
	SucceededDeleteGroup: { handle: Schema.String },
	FailedDeleteGroup: failed,
	GotDeleteConfirmMessage: { message: ConfirmAction.Message },
})
export type Message = typeof Message.Type
