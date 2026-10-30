import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

export const OrganizationRole = S.Literals(["admin", "member", "owner"])
export type OrganizationRole = S.Schema.Type<typeof OrganizationRole>

class Model extends M.Class<Model>("OrganizationMember")({
	id: M.Generated(OrganizationMemberId),
	organizationId: M.Immutable(OrganizationId),
	userId: M.Immutable(UserId),
	role: OrganizationRole,
	nickname: S.NullishOr(S.String),
	joinedAt: M.Immutable(JsonDate),
	invitedBy: M.Immutable(S.NullOr(UserId)),
	deletedAt: M.GeneratedByApp(S.NullOr(JsonDate)),
	createdAt: M.Generated(JsonDate),
}) {}

export const { Insert, Update, Schema, Create, Patch, PatchPartial } = M.expose(Model)
export type Type = typeof Schema.Type
