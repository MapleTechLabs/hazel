import { UserGroupId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { CommonReason } from "~/lib/error-messages"
import * as ConfirmAction from "../../shared/confirm-action"

export const Group = Schema.Struct({
	id: UserGroupId,
	handle: Schema.String,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	memberIds: Schema.Array(UserId),
})
export type Group = typeof Group.Type

/** A member of the organization, who can be put in a group. */
export const OrgMember = Schema.Struct({
	userId: UserId,
	name: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})
export type OrgMember = typeof OrgMember.Type

/** The name and handle being typed, for a new group or the open one. */
export const Form = Schema.Struct({
	name: Schema.String,
	handle: Schema.String,
	/** The handle was typed, not derived from the name. */
	isHandleEdited: Schema.Boolean,
})
export type Form = typeof Form.Type

/** Why a write failed: the handle is taken, the server refused a field (`detail`), or a shared reason. */
export const Failure = Schema.Union([Schema.Literals(["HandleTaken", "Invalid", "NotFound"]), CommonReason])
export type Failure = typeof Failure.Type

export const DeleteTarget = Schema.Struct({ id: UserGroupId, handle: Schema.String })
export type DeleteTarget = typeof DeleteTarget.Type

export const Model = Schema.Struct({
	/** `null` until the live query answers (the table draws skeleton rows). */
	groups: Schema.NullOr(Schema.Array(Group)),
	members: Schema.Array(OrgMember),
	/** The New group form, while open. */
	create: Schema.NullOr(Form),
	/** The group whose members are shown, and its rename form (owners and admins). */
	selectedId: Schema.NullOr(UserGroupId),
	edit: Schema.NullOr(Form),
	memberSearch: Schema.String,
	/** A create, save or member change is running. */
	isPending: Schema.Boolean,
	deleteConfirm: ConfirmAction.Model(DeleteTarget),
})
export type Model = typeof Model.Type
