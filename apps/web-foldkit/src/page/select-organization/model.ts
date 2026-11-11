import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import * as CreateWorkspace from "../create-workspace"

export const UserOrganization = Schema.Struct({
	id: OrganizationId,
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
	role: Schema.Literals(["owner", "admin", "member"]),
})
export type UserOrganization = typeof UserOrganization.Type

/**
 * The membership live query: `Loading` until it is ready, `Redirected` once a single organization
 * sent the user on (later emissions change nothing), otherwise the list to pick from.
 */
export const Organizations = defineTaggedUnion({
	Loading: {},
	Redirected: {},
	Loaded: { organizations: Schema.Array(UserOrganization) },
})
export type Organizations = typeof Organizations.Type

export const Model = Schema.Struct({
	organizations: Organizations,
	/** Shown when the user has no organization. */
	createWorkspace: CreateWorkspace.Model,
})
export type Model = typeof Model.Type
