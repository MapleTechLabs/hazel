import { Effect, Option, Schema } from "effect"
import { readStored, writeStored } from "./data/storage"

/** The notification sound settings the root owns (`Shared.soundSettings`); the sinks are in `app/`. */

/** `NotificationSoundSettings` (`atoms/notification-sound-atoms.ts`). */
export const SoundFile = Schema.Literals(["notification01", "notification03"])
export type SoundFile = typeof SoundFile.Type

export const SoundSettings = Schema.Struct({
	enabled: Schema.Boolean,
	volume: Schema.Number,
	soundFile: SoundFile,
	cooldownMs: Schema.Number,
})
export type SoundSettings = typeof SoundSettings.Type

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
	enabled: true,
	volume: 0.5,
	soundFile: "notification01",
	cooldownMs: 1000,
}

/** Same key and codec as `notificationSoundSettingsAtom`. */
const SOUND_SETTINGS_KEY = "notification-sound-settings"
const SoundSettingsCodec = Schema.toCodecIso(Schema.NullOr(SoundSettings))

export const loadSoundSettings: Effect.Effect<SoundSettings> = readStored(
	SOUND_SETTINGS_KEY,
	SoundSettingsCodec,
).pipe(Effect.map((stored) => Option.getOrNull(stored) ?? DEFAULT_SOUND_SETTINGS))

export const saveSoundSettings = (settings: SoundSettings) =>
	writeStored(SOUND_SETTINGS_KEY, SoundSettingsCodec, settings)
