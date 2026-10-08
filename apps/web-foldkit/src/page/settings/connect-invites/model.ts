import { ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import * as Interaction from "../../../ui/aria/interaction"

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
	/** Bumped per list request; an older response is dropped. */
	listVersion: Schema.Number,
	invites: Schema.Array(Invite),
	hostOrganizations: Schema.Array(HostOrganization),
	acceptingIds: Schema.Array(ConnectInviteId),
	decliningIds: Schema.Array(ConnectInviteId),
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type
