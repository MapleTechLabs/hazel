import { OrganizationId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { baseFields } from "./utils"

class Model extends M.Class<Model>("Organization")({
	id: M.Generated(OrganizationId),
	name: S.String,
	slug: S.NullOr(S.String),
	logoUrl: S.NullOr(S.String),
	settings: S.NullOr(S.Record(S.String, S.Unknown)),
	isPublic: S.Boolean,
	/**
	 * When unread state began here: a member with no read position is read up to then. Optional on
	 * the wire: a backend older than it sends none.
	 */
	readStateSince: M.Generated(S.optionalKey(S.NullOr(M.JsonDate))),
	...baseFields,
}) {}

export const { Insert, Update, Schema, Create, Patch, PatchPartial } = M.expose(Model)
export type Type = typeof Schema.Type
