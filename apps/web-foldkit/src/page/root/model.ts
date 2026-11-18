import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"

export const RootMembership = Schema.Struct({
	organizationId: OrganizationId,
	slug: Schema.NullOr(Schema.String),
})
export type RootMembership = typeof RootMembership.Type

export const Model = Schema.Struct({
	/** `undefined` until the live query is ready; empty when the user has no membership. */
	memberships: Schema.UndefinedOr(Schema.Array(RootMembership)),
	/** The organization last opened on this device (`data/last-organization.ts`); `undefined` until read. */
	lastOrganizationId: Schema.UndefinedOr(Schema.NullOr(OrganizationId)),
	/** Every org source has answered: `memberships` is complete, not just the orgs synced so far. */
	areOrgsSettled: Schema.Boolean,
	/** The page sign-in started from (`auth/return-to.ts`); `undefined` until read, `null` if none. */
	returnTo: Schema.UndefinedOr(Schema.NullOr(Schema.String)),
	hasRedirected: Schema.Boolean,
	/** The membership query has not loaded after a while: the loader offers a reload. */
	isStalled: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	UpdatedMemberships: { memberships: Schema.Array(RootMembership) },
	ReadLastOrganization: { organizationId: Schema.NullOr(OrganizationId) },
	SettledOrgSources: {},
	ReadReturnTo: { returnTo: Schema.NullOr(Schema.String) },
	CompletedForgetReturnTo: {},
	StalledMembership: {},
	PressedReload: {},
	CompletedReload: {},
})
export type Message = typeof Message.Type
