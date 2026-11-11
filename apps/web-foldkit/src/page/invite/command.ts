import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { load } from "foldkit/navigation"
import { catchCommon } from "../../data/actions"
import { AppRoute, hrefOf, signInHref } from "../../route"
import { HazelRpc } from "../../rpc"
import { Message } from "./message"

export const FetchPreview = Command.define("FetchPreview", {
	args: { token: Schema.String },
	messages: [Message.SucceededFetchPreview, Message.FailedFetchPreview],
	execute: ({ token }) =>
		HazelRpc.use((client) => client("invitation.preview", { token })).pipe(
			Effect.map((preview) =>
				Message.SucceededFetchPreview({
					preview: {
						organizationName: preview.organizationName,
						organizationLogoUrl: preview.organizationLogoUrl,
						email: preview.email,
						status: preview.status,
					},
				}),
			),
			Effect.catchTags({
				InvitationNotFoundError: () =>
					Effect.succeed(Message.FailedFetchPreview({ reason: "NotFound" })),
			}),
			catchCommon((reason) => Message.FailedFetchPreview({ reason })),
		),
})

/** Sign in, then come back to this link. */
export const RedirectToInviteSignIn = Command.define("RedirectToInviteSignIn", {
	args: { token: Schema.String },
	messages: [Message.LeftPage],
	execute: ({ token }) =>
		load(signInHref(hrefOf(AppRoute.Invite({ token })))).pipe(Effect.as(Message.LeftPage())),
})

/** Joins, then a full load of the workspace so its data starts syncing. */
export const AcceptInvitation = Command.define("AcceptInvitation", {
	args: { token: Schema.String },
	messages: [Message.LeftPage, Message.FailedAccept],
	execute: ({ token }) =>
		HazelRpc.use((client) => client("invitation.accept", { token })).pipe(
			Effect.flatMap((accepted) =>
				load(
					accepted.slug
						? hrefOf(AppRoute.OrgHome({ orgSlug: accepted.slug }))
						: hrefOf(AppRoute.Root()),
				),
			),
			Effect.as(Message.LeftPage()),
			Effect.catchTags({
				InvitationEmailMismatchError: () =>
					Effect.succeed(Message.FailedAccept({ reason: "EmailMismatch" })),
				InvitationUnavailableError: () =>
					Effect.succeed(Message.FailedAccept({ reason: "NoLongerValid" })),
				InvitationNotFoundError: () =>
					Effect.succeed(Message.FailedAccept({ reason: "NoLongerValid" })),
				OrganizationNotFoundError: () =>
					Effect.succeed(Message.FailedAccept({ reason: "WorkspaceGone" })),
			}),
			catchCommon((reason) => Message.FailedAccept({ reason })),
		),
})
