import { ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"
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

/** The incoming invites; `connectShare.invite.listIncoming` fails only with the shared reasons. */
export const Invites = AsyncData.Schema(Schema.Array(Invite), CommonReason)
export type Invites = typeof Invites.schema.Type

/** Why declining failed, beyond the shared reasons. */
export const DeclineFailure = Schema.Union([
	Schema.Literals(["NotFound", "InvalidState", "WorkspaceNotFound"]),
	CommonReason,
])
export type DeclineFailure = typeof DeclineFailure.Type

/** Why accepting failed: the decline reasons, and the channel already being shared. */
export const AcceptFailure = Schema.Union([
	Schema.Literals(["AlreadyShared", "ChannelNotFound"]),
	DeclineFailure,
])
export type AcceptFailure = typeof AcceptFailure.Type

export const Model = Schema.Struct({
	/** The organization the list was last requested for (the legacy query atom's key). */
	requestedFor: Schema.NullOr(OrganizationId),
	/** Bumped per list request; an older response is dropped. */
	listVersion: Schema.Number,
	invites: Invites.schema,
	hostOrganizations: Schema.Array(HostOrganization),
	acceptingIds: Schema.Array(ConnectInviteId),
	decliningIds: Schema.Array(ConnectInviteId),
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type
