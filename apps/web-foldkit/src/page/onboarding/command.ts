import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Duration, Effect, Schema } from "effect"
import { Command } from "foldkit"
import { load, replaceUrl } from "foldkit/navigation"
import { orgOfMember } from "~/db/routing-hints"
import { catchCommon } from "../../data/actions"
import { sendInvitations } from "../../data/invitations"
import { HazelRpc } from "../../rpc"
import { Message } from "./message"

export const ReadBrowserTimezone = Command.define("ReadBrowserTimezone", {
	messages: [Message.DetectedBrowserTimezone],
	execute: Effect.sync(() =>
		Message.DetectedBrowserTimezone({
			browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		}),
	),
})

/** `navigate({ search: (prev) => ({ ...prev, step }), replace: true })`, the href from `onboardingHref`. */
export const ReplaceOnboardingStepUrl = Command.define("ReplaceOnboardingStepUrl", {
	args: { href: Schema.String },
	messages: [Message.CompletedReplaceStepUrl],
	execute: ({ href }) => replaceUrl(href).pipe(Effect.as(Message.CompletedReplaceStepUrl())),
})

/** The profile step's name, through `user.update`. */
export const UpdateProfile = Command.define("UpdateProfile", {
	args: { userId: UserId, firstName: Schema.String, lastName: Schema.String },
	messages: [Message.SucceededUpdateProfile, Message.FailedUpdateProfile],
	execute: ({ userId, firstName, lastName }) =>
		HazelRpc.use((client) => client("user.update", { id: userId, firstName, lastName })).pipe(
			Effect.as(Message.SucceededUpdateProfile()),
			Effect.catchTags({
				UserNotFoundError: () =>
					Effect.succeed(Message.FailedUpdateProfile({ reason: "UserNotFound" })),
			}),
			catchCommon((reason) => Message.FailedUpdateProfile({ reason })),
		),
})

export const DebounceTimezoneQuery = Command.define("DebounceTimezoneQuery", {
	args: { query: Schema.String },
	messages: [Message.ElapsedTimezoneDebounce],
	execute: ({ query }) =>
		Effect.sleep(Duration.millis(150)).pipe(Effect.as(Message.ElapsedTimezoneDebounce({ query }))),
})

export const UpdateUserTimezone = Command.define("UpdateUserTimezone", {
	args: { userId: UserId, timezone: Schema.String },
	messages: [Message.SucceededUpdateTimezone, Message.FailedUpdateTimezone],
	execute: ({ userId, timezone }) =>
		HazelRpc.use((client) => client("user.update", { id: userId, timezone })).pipe(
			Effect.as(Message.SucceededUpdateTimezone({ timezone })),
			Effect.catchTags({
				UserNotFoundError: () =>
					Effect.succeed(Message.FailedUpdateTimezone({ reason: "UserNotFound" })),
			}),
			catchCommon((reason) => Message.FailedUpdateTimezone({ reason })),
		),
})

/** Invites each address to the user's organization as a member. */
export const SendInvites = Command.define("SendInvites", {
	args: { organizationId: OrganizationId, emails: Schema.Array(Schema.String) },
	messages: [Message.SucceededSendInvites, Message.FailedSendInvites],
	execute: ({ organizationId, emails }) =>
		sendInvitations(
			organizationId,
			emails.map((email) => ({ email, role: "member" as const })),
		).pipe(
			Effect.map(({ errorCount }) =>
				errorCount === emails.length
					? Message.FailedSendInvites({ reason: "AllFailed" })
					: Message.SucceededSendInvites({ emails, failedCount: errorCount }),
			),
		),
})

/** `handleFinalization`: finalize first (critical), then the best-effort metadata. */
export const CompleteOnboarding = Command.define("CompleteOnboarding", {
	args: {
		memberId: Schema.NullOr(OrganizationMemberId),
		role: Schema.NullOr(Schema.String),
		useCases: Schema.Array(Schema.String),
	},
	messages: [Message.SucceededCompleteOnboarding, Message.FailedCompleteOnboarding],
	execute: ({ memberId, role, useCases }) =>
		HazelRpc.use((client) => client("user.finalizeOnboarding", undefined)).pipe(
			Effect.andThen(
				memberId === null
					? Effect.void
					: HazelRpc.use((client) =>
							client("organizationMember.updateMetadata", {
								id: memberId,
								organizationId: orgOfMember(memberId),
								metadata: { ...(role === null ? {} : { role }), useCases },
							}),
						).pipe(
							// Best effort: the answers are nice to have, and onboarding is already finished.
							Effect.ignore,
						),
			),
			Effect.as(Message.SucceededCompleteOnboarding()),
			catchCommon((reason) => Message.FailedCompleteOnboarding({ reason })),
		),
})

/** A full reload, so a cached `user.me` can't bounce the user back here. */
export const LoadOnboardingHome = Command.define("LoadOnboardingHome", {
	args: { href: Schema.String },
	messages: [Message.CompletedLoadHome],
	execute: ({ href }) => load(href).pipe(Effect.as(Message.CompletedLoadHome())),
})
