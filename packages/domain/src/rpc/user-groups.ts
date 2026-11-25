/**
 * User groups: Discord's mentionable roles. An organization's owners and admins create, rename and
 * delete groups and choose their members; every member can mention one (`@[group:<id>]`). The rows
 * stream to the org's members (`user_groups`, `user_group_members`), so there is no read RPC.
 */
import { OrganizationId, TransactionId, UserGroupId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { InternalServerError, UnauthorizedError } from "../errors"
import { UserGroup } from "../models"
import { RequiredScopes } from "../scopes/required-scopes"
import { AuthMiddleware } from "./middleware"

export class UserGroupResponse extends Schema.Class<UserGroupResponse, { readonly brand: unique symbol }>(
	"UserGroupResponse",
)({
	data: UserGroup.Schema,
	transactionId: TransactionId,
}) {}

export class UserGroupNotFoundError extends Schema.TaggedError<
	UserGroupNotFoundError,
	{ readonly brand: unique symbol }
>()("UserGroupNotFoundError", {
	groupId: UserGroupId,
}) {}

/** Another group of the organization (not deleted) has the handle. */
export class UserGroupHandleTakenError extends Schema.TaggedError<
	UserGroupHandleTakenError,
	{ readonly brand: unique symbol }
>()("UserGroupHandleTakenError", {
	handle: Schema.String,
}) {}

/** A handle, name or description the group cannot take, or members who are not the org's. */
export class UserGroupInvalidError extends Schema.TaggedError<
	UserGroupInvalidError,
	{ readonly brand: unique symbol }
>()("UserGroupInvalidError", {
	field: Schema.Literals(["handle", "name", "description", "members"]),
	message: Schema.String,
}) {}

const Members = Schema.Array(UserId).check(Schema.isMaxLength(500))

const WriteErrors = [UserGroupInvalidError, UnauthorizedError, InternalServerError] as const

export class UserGroupRpcs extends RpcGroup.make(
	/** Create a group, optionally with its first members. Owners and admins only. */
	Rpc.make("userGroup.create", {
		payload: Schema.Struct({
			/** Client id, for the optimistic row. */
			id: Schema.optional(UserGroupId),
			organizationId: OrganizationId,
			handle: Schema.String,
			name: Schema.String,
			description: Schema.optional(Schema.NullOr(Schema.String)),
			memberIds: Schema.optional(Members),
		}),
		success: UserGroupResponse,
		error: Schema.Union([UserGroupHandleTakenError, ...WriteErrors]),
	})
		.annotate(RequiredScopes, ["organization-members:write"])
		.middleware(AuthMiddleware),

	/** Rename a group, change its handle or description. Owners and admins only. */
	Rpc.make("userGroup.update", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			id: UserGroupId,
			handle: Schema.optional(Schema.String),
			name: Schema.optional(Schema.String),
			description: Schema.optional(Schema.NullOr(Schema.String)),
		}),
		success: UserGroupResponse,
		error: Schema.Union([UserGroupNotFoundError, UserGroupHandleTakenError, ...WriteErrors]),
	})
		.annotate(RequiredScopes, ["organization-members:write"])
		.middleware(AuthMiddleware),

	/** Delete a group (soft) and its memberships; its mentions in old messages stop resolving. */
	Rpc.make("userGroup.delete", {
		payload: Schema.Struct({ organizationId: OrganizationId, id: UserGroupId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([UserGroupNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organization-members:write"])
		.middleware(AuthMiddleware),

	/** Add members of the organization to a group; ones already in it are left as they are. */
	Rpc.make("userGroup.addMembers", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			groupId: UserGroupId,
			userIds: Members,
		}),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([UserGroupNotFoundError, ...WriteErrors]),
	})
		.annotate(RequiredScopes, ["organization-members:write"])
		.middleware(AuthMiddleware),

	/** Take a member out of a group. */
	Rpc.make("userGroup.removeMember", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			groupId: UserGroupId,
			userId: UserId,
		}),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([UserGroupNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organization-members:write"])
		.middleware(AuthMiddleware),
) {}
