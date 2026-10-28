/**
 * TODO(do-sync): runs in the directory (D1) (`rpc/routing.ts`); not ported yet. To port: touch only that
 * store's tables and send everything else through the outbox (`worker/objects/effects`).
 * - no transactions; accept adds an org member: enqueue to the OrgObject
 */
import { InvitationRpcs } from "@hazel/domain/rpc"
import { Effect } from "effect"
import { Invitations } from "../../services/invitations"

export const InvitationRpcLive = InvitationRpcs.toLayer(
	Effect.gen(function* () {
		const invitations = yield* Invitations
		return {
			"invitation.create": invitations.create,
			"invitation.list": invitations.list,
			"invitation.revoke": invitations.revoke,
			"invitation.preview": invitations.preview,
			"invitation.accept": invitations.accept,
		}
	}),
)
