import { Effect, Exit, Schema } from "effect"
import { Command } from "foldkit"
import { load } from "foldkit/navigation"
import { type ErrorHandlers, failureToast } from "../../data/actions"
import { signInHref } from "../../route"
import { HazelRpc } from "../../rpc"
import { Message } from "./message"

export const FetchOrganization = Command.define("FetchPublicOrganization", {
	args: { slug: Schema.String },
	messages: [Message.SucceededFetchOrganization, Message.FailedFetchOrganization],
	execute: ({ slug }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const organization = yield* client("organization.getBySlugPublic", { slug })
			return Message.SucceededFetchOrganization({
				organization: organization
					? {
							name: organization.name,
							logoUrl: organization.logoUrl ?? null,
							memberCount: organization.memberCount,
						}
					: null,
			})
		}).pipe(Effect.catch(() => Effect.succeed(Message.FailedFetchOrganization()))),
})

/** The toasts legacy's `exitToastAsync(...).onErrorTag(...)` chain shows. */
const knownFailures: ErrorHandlers = {
	OrganizationNotFoundError: {
		title: "Organization not found",
		description: "This organization may have been deleted.",
	},
	PublicInviteDisabledError: {
		title: "Public invites disabled",
		description: "This organization has disabled public invites.",
	},
	AlreadyMemberError: {
		title: "Already a member",
		description: "You're already a member of this workspace.",
	},
}

export const JoinWorkspace = Command.define("JoinWorkspace", {
	args: { slug: Schema.String },
	messages: [Message.SucceededJoinWorkspace, Message.FailedJoinWorkspace],
	execute: ({ slug }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(client("organization.joinViaPublicInvite", { slug }))
			if (Exit.isSuccess(exit)) return Message.SucceededJoinWorkspace()
			return Message.FailedJoinWorkspace({ toast: failureToast(exit.cause, "friendly", knownFailures) })
		}),
})

/** `login({ returnTo })`: a full page load of Clerk's sign-in, coming back here afterwards. */
export const RedirectToSignIn = Command.define("RedirectToSignIn", {
	args: { returnTo: Schema.String },
	messages: [Message.CompletedRedirectToSignIn],
	execute: ({ returnTo }) =>
		load(signInHref(returnTo)).pipe(Effect.as(Message.CompletedRedirectToSignIn())),
})
