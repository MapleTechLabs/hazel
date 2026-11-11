import { InvitationRole } from "@hazel/domain/rpc"
import { InvitationId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"
import * as Menu from "../../../ui/menu"

export const Invitation = Schema.Struct({
	id: InvitationId,
	emailAddress: Schema.String,
	role: InvitationRole,
	createdAtMs: Schema.Number,
})
export type Invitation = typeof Invitation.Type

/** The pending invitations; `invitation.list` fails only with the shared reasons. */
export const Invitations = AsyncData.Schema(Schema.Array(Invitation), CommonReason)
export type Invitations = typeof Invitations.schema.Type

/** Why a revoke failed, beyond the shared reasons. */
export const RevokeFailure = Schema.Union([Schema.Literal("NotFound"), CommonReason])
export type RevokeFailure = typeof RevokeFailure.Type

export const RowMenu = Schema.Struct({ invitationId: InvitationId, menu: Menu.Model })
export type RowMenu = typeof RowMenu.Type

export const Model = Schema.Struct({
	/** The route's organization; `null` until it has loaded. */
	organizationId: Schema.NullOr(OrganizationId),
	invitations: Invitations.schema,
	/** Bumped per fetch; an older result (initial fetch racing a post-revoke refetch) is dropped. */
	fetchVersion: Schema.Number,
	menus: Schema.Array(RowMenu),
	revokingId: Schema.NullOr(InvitationId),
})
export type Model = typeof Model.Type
