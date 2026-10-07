import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"

export const PublicOrganization = Schema.Struct({
	name: Schema.String,
	logoUrl: Schema.NullOr(Schema.String),
	memberCount: Schema.Number,
})
export type PublicOrganization = typeof PublicOrganization.Type

/** `organization.getBySlugPublic`; a failed lookup reads as not found, like `getOrElse(() => null)`. */
export const Lookup = defineTaggedUnion({
	Loading: {},
	Loaded: { organization: Schema.NullOr(PublicOrganization) },
})
export type Lookup = typeof Lookup.Type

export const Model = Schema.Struct({
	slug: Schema.String,
	lookup: Lookup,
	isJoining: Schema.Boolean,
})
export type Model = typeof Model.Type
