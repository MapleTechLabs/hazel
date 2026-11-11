import { CustomEmojiId, OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

class Model extends M.Class<Model>("CustomEmoji")({
	id: M.Generated(CustomEmojiId),
	organizationId: OrganizationId,
	name: S.String,
	imageUrl: S.String,
	createdBy: M.Immutable(UserId),
	createdAt: M.Generated(JsonDate),
	updatedAt: M.Generated(S.NullOr(JsonDate)),
	deletedAt: M.Generated(S.NullOr(JsonDate)),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
