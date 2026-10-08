import { User } from "@hazel/domain/models"
import { UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { Command } from "foldkit"
import { testNativeNotification } from "~/lib/native-notifications"
import { notificationSoundManager } from "~/lib/notification-sound-manager"
import { updateUser } from "../user"
import { Message } from "./message"

export const PlayTestSound = Command.define("PlayTestSound", {
	args: {},
	messages: [Message.CompletedTestSound],
	execute: () =>
		Effect.promise(() => notificationSoundManager.testSound()).pipe(
			Effect.as(Message.CompletedTestSound()),
		),
})

export const SendTestNotification = Command.define("SendTestNotification", {
	args: {},
	messages: [Message.CompletedTestNotification],
	execute: () =>
		Effect.tryPromise(() => testNativeNotification()).pipe(
			Effect.catch(() => Effect.succeed(false)),
			Effect.map((isSent) => Message.CompletedTestNotification({ isSent })),
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
		updateUser({ id: userId, settings }).pipe(
			Effect.as(Message.SucceededUpdateUserSettings()),
			Effect.catch(() => Effect.succeed(Message.FailedUpdateUserSettings())),
		),
})
