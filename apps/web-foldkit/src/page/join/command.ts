import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { load } from "foldkit/navigation"
import { catchCommon } from "../../data/actions"
import { signInHref } from "../../route"
import { HazelRpc } from "../../rpc"
import { Message } from "./message"

export const FetchPublicOrganization = Command.define("FetchPublicOrganization", {
	args: { slug: Schema.String },
	messages: [Message.SucceededFetchOrganization, Message.FailedFetchOrganization],
	execute: ({ slug }) =>
		HazelRpc.use((client) => client("organization.getBySlugPublic", { slug })).pipe(
			Effect.map((organization) =>
				Message.SucceededFetchOrganization({
					organization: organization
						? {
								name: organization.name,
								logoUrl: organization.logoUrl ?? null,
								memberCount: organization.memberCount,
							}
						: null,
				}),
			),
			catchCommon((reason) => Message.FailedFetchOrganization({ reason })),
		),
})

export const JoinWorkspace = Command.define("JoinWorkspace", {
	args: { slug: Schema.String },
	messages: [Message.SucceededJoinWorkspace, Message.FailedJoinWorkspace],
	execute: ({ slug }) =>
		HazelRpc.use((client) => client("organization.joinViaPublicInvite", { slug })).pipe(
			Effect.as(Message.SucceededJoinWorkspace()),
			Effect.catchTags({
				OrganizationNotFoundError: () =>
					Effect.succeed(Message.FailedJoinWorkspace({ reason: "NotFound" })),
				PublicInviteDisabledError: () =>
					Effect.succeed(Message.FailedJoinWorkspace({ reason: "PublicInvitesDisabled" })),
				AlreadyMemberError: () =>
					Effect.succeed(Message.FailedJoinWorkspace({ reason: "AlreadyMember" })),
			}),
			catchCommon((reason) => Message.FailedJoinWorkspace({ reason })),
		),
})

/** `login({ returnTo })`: a full page load of sign-in, coming back here afterwards. */
export const RedirectToSignIn = Command.define("RedirectToSignIn", {
	args: { returnTo: Schema.String },
	messages: [Message.CompletedRedirectToSignIn],
	execute: ({ returnTo }) =>
		load(signInHref(returnTo)).pipe(Effect.as(Message.CompletedRedirectToSignIn())),
})
