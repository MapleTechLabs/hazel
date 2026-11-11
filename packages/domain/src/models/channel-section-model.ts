import { ChannelSectionId, OrganizationId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { baseFields } from "./utils"

class Model extends M.Class<Model>("ChannelSection")({
	id: M.GeneratedOptional(ChannelSectionId),
	organizationId: M.Immutable(OrganizationId),
	name: S.String,
	order: S.Number,
	...baseFields,
}) {}

export const { Insert, Update, Schema, Create, Patch, PatchPartial } = M.expose(Model)
export type Type = typeof Schema.Type
