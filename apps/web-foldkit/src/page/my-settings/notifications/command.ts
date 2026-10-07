import { User } from "@hazel/domain/models"
import { UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { Command } from "foldkit"
import { testNativeNotification } from "~/lib/native-notifications"
import { notificationSoundManager } from "~/lib/notification-sound-manager"
import { readStored, writeStored } from "../../../data/storage"
import { updateUser } from "../user"
import { Message } from "./message"
import { DEFAULT_SOUND_SETTINGS, SoundSettings } from "./model"

/** Same key and codec as `notificationSoundSettingsAtom`. */
const SOUND_SETTINGS_KEY = "notification-sound-settings"
const SoundSettingsCodec = Schema.toCodecIso(Schema.NullOr(SoundSettings))

export const LoadSoundSettings = Command.define("LoadSoundSettings", {
	args: {},
	messages: [Message.LoadedSoundSettings],
	execute: () =>
		readStored(SOUND_SETTINGS_KEY, SoundSettingsCodec).pipe(
			Effect.map((stored) =>
				Message.LoadedSoundSettings({
					sound: Option.getOrNull(stored) ?? DEFAULT_SOUND_SETTINGS,
				}),
			),
		),
})

export const SaveSoundSettings = Command.define("SaveSoundSettings", {
	args: { sound: SoundSettings },
	messages: [Message.CompletedSaveSoundSettings],
	execute: ({ sound }) =>
		writeStored(SOUND_SETTINGS_KEY, SoundSettingsCodec, sound).pipe(
			Effect.as(Message.CompletedSaveSoundSettings()),
		),
})

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
	args: {},
	messages: [Message.ExpiredNotificationStatus],
	execute: () => Effect.sleep("3 seconds").pipe(Effect.as(Message.ExpiredNotificationStatus())),
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
