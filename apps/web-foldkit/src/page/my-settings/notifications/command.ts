import { User } from "@hazel/domain/models"
import { OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { testNativeNotification } from "~/lib/native-notifications"
import { notificationSoundManager } from "~/lib/notification-sound-manager"
import { settleUpdateUser, updateUser } from "../user"
import { Message } from "./message"
import { OrganizationSettings, payloadOf } from "./organization"
import { channelResetOf, Override } from "./overrides"
import { updateChannelMemberAction } from "~/db/actions"
import { catchCommon } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"

/** A sound or notification preview threw (audio playback, the notification plugin). */
class TestPreviewError extends Schema.TaggedError<TestPreviewError, { readonly brand: unique symbol }>()(
	"TestPreviewError",
	{
		cause: Schema.Defect(),
	},
) {}

const preview = <A>(run: () => Promise<A>) =>
	Effect.tryPromise({ try: run, catch: (cause) => new TestPreviewError({ cause }) })

export const PlayTestSound = Command.define("PlayTestSound", {
	messages: [Message.CompletedTestSound],
	execute: preview(() => notificationSoundManager.testSound()).pipe(
		// Best-effort preview: `testSound` reports its own outcomes, and a throw has nothing to show.
		Effect.ignore,
		Effect.as(Message.CompletedTestSound()),
	),
})

export const SendTestNotification = Command.define("SendTestNotification", {
	messages: [Message.SucceededSendTestNotification, Message.FailedSendTestNotification],
	execute: preview(testNativeNotification).pipe(
		Effect.map((isSent) =>
			isSent
				? Message.SucceededSendTestNotification()
				: Message.FailedSendTestNotification({ reason: "Unavailable" }),
		),
		Effect.catchTags({
			TestPreviewError: () =>
				Effect.succeed(Message.FailedSendTestNotification({ reason: "SendFailed" })),
		}),
	),
})

/** The legacy `setTimeout(() => setNotificationStatus("idle"), 3000)`. */
export const ExpireNotificationStatus = Command.define("ExpireNotificationStatus", {
	args: { version: Schema.Finite },
	messages: [Message.ExpiredNotificationStatus],
	execute: ({ version }) =>
		Effect.sleep("3 seconds").pipe(Effect.as(Message.ExpiredNotificationStatus({ version }))),
})

export const UpdateUserSettings = Command.define("UpdateUserSettings", {
	args: { userId: UserId, settings: User.UserSettingsSchema },
	messages: [Message.SucceededUpdateUserSettings, Message.FailedUpdateUserSettings],
	execute: ({ userId, settings }) =>
		settleUpdateUser(
			updateUser({ id: userId, settings }),
			Message.SucceededUpdateUserSettings(),
			(reason) => Message.FailedUpdateUserSettings({ reason }),
		),
})

/** "This organization": the whole chosen snapshot, written as the user's organization-scoped settings. */
export const SaveOrganizationSettings = Command.define("SaveOrganizationSettings", {
	args: { organizationId: OrganizationId, settings: OrganizationSettings },
	messages: [Message.SucceededSaveOrganizationSettings, Message.FailedSaveOrganizationSettings],
	execute: ({ organizationId, settings }) =>
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			yield* rpc("channelMember.setScopeNotifications", payloadOf(organizationId, settings))
			return Message.SucceededSaveOrganizationSettings()
		}).pipe(
			Effect.catchTags({
				UnauthorizedError: () => Effect.succeed(Message.FailedSaveOrganizationSettings()),
				ChannelSectionNotFoundError: () => Effect.succeed(Message.FailedSaveOrganizationSettings()),
			}),
			catchCommon(() => Message.FailedSaveOrganizationSettings()),
		),
})

/** "Reset": the channel's or section's own level and mute go, so what is above applies again. */
export const ResetOverride = Command.define("ResetOverride", {
	args: { organizationId: OrganizationId, override: Override },
	messages: [Message.CompletedResetOverride],
	execute: ({ organizationId, override }) =>
		Effect.gen(function* () {
			if (override._tag === "Channel") {
				yield* updateChannelMemberAction(channelResetOf(override.memberId))
			} else {
				const rpc = yield* HazelRpc
				yield* rpc("channelMember.resetScopeNotifications", {
					organizationId,
					scope: "section",
					scopeId: override.sectionId,
				})
			}
			return Message.CompletedResetOverride({ isSuccess: true })
		}).pipe(
			Effect.catchTags({
				ChannelMemberNotFoundError: () =>
					Effect.succeed(Message.CompletedResetOverride({ isSuccess: false })),
				UnauthorizedError: () => Effect.succeed(Message.CompletedResetOverride({ isSuccess: false })),
			}),
			catchCommon(() => Message.CompletedResetOverride({ isSuccess: false })),
		),
})
