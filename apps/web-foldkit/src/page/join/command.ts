import { Cause, Effect, Exit, Option, Schema } from "effect"
import { Command } from "foldkit"
import { load, pushUrl } from "foldkit/navigation"
import { getUserFriendlyError } from "~/lib/error-messages"
import { HazelRpc } from "../../rpc"
import { Message } from "./message"

export const FetchOrganization = Command.define("FetchPublicOrganization", {
	args: { slug: Schema.String },
	messages: [Message.SucceededFetchOrganization],
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
		}).pipe(
			Effect.catch(() => Effect.succeed(Message.SucceededFetchOrganization({ organization: null }))),
		),
})

/** The toasts legacy's `exitToastAsync(...).onErrorTag(...)` chain shows. */
const knownFailures: Readonly<Record<string, { title: string; description: string }>> = {
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
			const tag = Option.match(Cause.findErrorOption(exit.cause), {
				onNone: () => "",
				onSome: (error) => error._tag,
			})
			const known = knownFailures[tag]
			if (known) return Message.FailedJoinWorkspace(known)
			const friendly = getUserFriendlyError(exit.cause)
			return Message.FailedJoinWorkspace({
				title: friendly.title,
				description: friendly.description ?? null,
			})
		}),
})

/** `login({ returnTo })`: a full page load of Clerk's sign-in, coming back here afterwards. */
export const RedirectToSignIn = Command.define("RedirectToSignIn", {
	args: { returnTo: Schema.String },
	messages: [Message.CompletedRedirectToSignIn],
	execute: ({ returnTo }) =>
		load(`/sign-in?${new URLSearchParams({ redirect_url: returnTo })}`).pipe(
			Effect.as(Message.CompletedRedirectToSignIn()),
		),
})

export const NavigateToWorkspace = Command.define("NavigateToWorkspace", {
	args: { slug: Schema.String },
	messages: [Message.CompletedNavigateToWorkspace],
	execute: ({ slug }) => pushUrl(`/${slug}`).pipe(Effect.as(Message.CompletedNavigateToWorkspace())),
})
