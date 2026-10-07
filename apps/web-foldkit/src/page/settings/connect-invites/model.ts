import { ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"

export const Invite = Schema.Struct({
	id: ConnectInviteId,
	hostOrganizationId: OrganizationId,
	status: Schema.String,
	createdAtMs: Schema.Number,
})
export type Invite = typeof Invite.Type

export const HostOrganization = Schema.Struct({ id: OrganizationId, name: Schema.String })
export type HostOrganization = typeof HostOrganization.Type

export const Model = Schema.Struct({
	/** The organization the list was last requested for (the legacy query atom's key). */
	requestedFor: Schema.NullOr(OrganizationId),
	invites: Schema.Array(Invite),
	hostOrganizations: Schema.Array(HostOrganization),
	acceptingIds: Schema.Array(ConnectInviteId),
	decliningIds: Schema.Array(ConnectInviteId),
})
export type Model = typeof Model.Type
