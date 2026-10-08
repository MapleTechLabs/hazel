import { OrganizationMemberId, UserId } from "@hazel/schema"
import { Cause, Duration, Effect, Exit, Option, Schema } from "effect"
import { Command } from "foldkit"
import { load, replaceUrl } from "foldkit/navigation"
import { getUserFriendlyError } from "~/lib/error-messages"
import { HazelRpc } from "../../rpc"
import { clerkResource } from "./clerk"
import { Message } from "./message"

export const ReadBrowserTimezone = Command.define("ReadBrowserTimezone", {
	args: {},
	messages: [Message.GotBrowserTimezone],
	execute: () =>
		Effect.sync(() =>
			Message.GotBrowserTimezone({ browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
		),
})

/** `navigate({ search: (prev) => ({ ...prev, step }), replace: true })`, the href from `onboardingHref`. */
export const ReplaceStepUrl = Command.define("ReplaceOnboardingStepUrl", {
	args: { href: Schema.String },
	messages: [Message.CompletedReplaceStepUrl],
	execute: ({ href }) => replaceUrl(href).pipe(Effect.as(Message.CompletedReplaceStepUrl())),
})

/** `clerkUser.update({ firstName, lastName })` */
export const UpdateProfile = Command.define("UpdateClerkProfile", {
	args: { firstName: Schema.String, lastName: Schema.String },
	messages: [Message.SucceededUpdateProfile, Message.FailedUpdateProfile],
	execute: ({ firstName, lastName }) =>
		Effect.tryPromise(() => clerkResource.updateUser({ firstName, lastName })).pipe(
			Effect.as(Message.SucceededUpdateProfile()),
			Effect.catch(() => Effect.succeed(Message.FailedUpdateProfile())),
		),
})

export const DebounceTimezoneQuery = Command.define("DebounceTimezoneQuery", {
	args: { query: Schema.String },
	messages: [Message.ElapsedTimezoneDebounce],
	execute: ({ query }) =>
		Effect.sleep(Duration.millis(150)).pipe(Effect.as(Message.ElapsedTimezoneDebounce({ query }))),
})

export const UpdateTimezone = Command.define("UpdateUserTimezone", {
	args: { userId: UserId, timezone: Schema.String },
	messages: [Message.SucceededUpdateTimezone, Message.FailedUpdateTimezone],
	execute: ({ userId, timezone }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(client("user.update", { id: userId, timezone }))
			if (Exit.isSuccess(exit)) return Message.SucceededUpdateTimezone({ timezone })
			const isUserNotFound = Option.exists(
				Cause.findErrorOption(exit.cause),
				(error) => error._tag === "UserNotFoundError",
			)
			if (isUserNotFound)
				return Message.FailedUpdateTimezone({
					title: "User not found",
					description: "Your account could not be found. Please try signing in again.",
				})
			const friendly = getUserFriendlyError(exit.cause)
			return Message.FailedUpdateTimezone({
				title: friendly.title,
				description: friendly.description ?? null,
			})
		}),
})

/** `organization.inviteMember` for each address on the active Clerk organization. */
export const SendInvites = Command.define("SendInvites", {
	args: { emails: Schema.Array(Schema.String) },
	messages: [Message.SucceededSendInvites, Message.FailedSendInvites],
	execute: ({ emails }) =>
		Effect.suspend(() =>
			clerkResource.hasOrganization()
				? Effect.tryPromise(() => clerkResource.inviteMembers(emails)).pipe(
						Effect.map((results) => {
							const failedCount = results.filter((result) => result.status === "rejected").length
							return failedCount === emails.length
								? Message.FailedSendInvites({ reason: "AllFailed" })
								: Message.SucceededSendInvites({ emails, failedCount })
						}),
						Effect.catch(() => Effect.succeed(Message.FailedSendInvites({ reason: "AllFailed" }))),
					)
				: Effect.succeed(Message.FailedSendInvites({ reason: "NoOrganization" })),
		),
})

/** `handleFinalization`: finalize first (critical), then the best-effort metadata and invites. */
export const CompleteOnboarding = Command.define("CompleteOnboarding", {
	args: {
		memberId: Schema.NullOr(OrganizationMemberId),
		role: Schema.NullOr(Schema.String),
		useCases: Schema.Array(Schema.String),
		emails: Schema.Array(Schema.String),
	},
	messages: [Message.SucceededCompleteOnboarding, Message.FailedCompleteOnboarding],
	execute: ({ memberId, role, useCases, emails }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const finalized = yield* Effect.exit(client("user.finalizeOnboarding", undefined))
			if (Exit.isFailure(finalized))
				return Message.FailedCompleteOnboarding({ error: "Failed to finalize onboarding" })
			if (memberId !== null)
				yield* client("organizationMember.updateMetadata", {
					id: memberId,
					metadata: { ...(role === null ? {} : { role }), useCases },
				}).pipe(Effect.ignore)
			if (clerkResource.hasOrganization() && emails.length > 0)
				yield* Effect.tryPromise(() => clerkResource.inviteMembers(emails)).pipe(Effect.ignore)
			return Message.SucceededCompleteOnboarding()
		}),
})

/** A full reload, so a cached `user.me` can't bounce the user back here. */
export const LoadHome = Command.define("LoadOnboardingHome", {
	args: { href: Schema.String },
	messages: [Message.CompletedLoadHome],
	execute: ({ href }) => load(href).pipe(Effect.as(Message.CompletedLoadHome())),
})
