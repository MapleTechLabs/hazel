import { ChannelIcon, ChannelId, ChannelSectionId, OrganizationId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { baseFields } from "./utils"

export const ChannelType = S.Literals(["public", "private", "thread", "direct", "single"])
export type ChannelType = S.Schema.Type<typeof ChannelType>

class Model extends M.Class<Model>("Channel")({
	id: M.GeneratedOptional(ChannelId),
	name: S.String,
	icon: S.NullOr(ChannelIcon),
	type: M.Immutable(ChannelType),
	organizationId: M.Immutable(OrganizationId),
	parentChannelId: M.Immutable(S.NullOr(ChannelId)),
	sectionId: S.NullOr(ChannelSectionId),
	...baseFields,
}) {}

export const { Insert, Update, Schema, Create, Patch, PatchPartial } = M.expose(Model)
export type Type = typeof Schema.Type
