import { User } from "@hazel/domain/models"
import { UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { testNativeNotification } from "~/lib/native-notifications"
import { notificationSoundManager } from "~/lib/notification-sound-manager"
import { settleUpdateUser, updateUser } from "../user"
import { Message } from "./message"

/** A sound or notification preview threw (audio playback, the notification plugin). */
class TestPreviewError extends Schema.TaggedError<TestPreviewError>()("TestPreviewError", {
	cause: Schema.Defect(),
}) {}

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
	args: { version: Schema.Number },
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
