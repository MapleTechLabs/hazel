import { Effect, Option, Schema } from "effect"
import { readStored, writeStored } from "./data/storage"

/** The notification sound settings the root owns (`Shared.soundSettings`); the sinks are in `app/`. */

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

/** The legacy app's key and codec, so saved settings carry over. */
const SOUND_SETTINGS_KEY = "notification-sound-settings"
const SoundSettingsCodec = Schema.toCodecIso(Schema.NullOr(SoundSettings))

export const loadSoundSettings: Effect.Effect<SoundSettings> = readStored(
	SOUND_SETTINGS_KEY,
	SoundSettingsCodec,
).pipe(Effect.map((stored) => Option.getOrNull(stored) ?? DEFAULT_SOUND_SETTINGS))

export const saveSoundSettings = (settings: SoundSettings) =>
	writeStored(SOUND_SETTINGS_KEY, SoundSettingsCodec, settings)

const minutesOfDay = (time: string): number => {
	const [hours, minutes] = time.split(":").map(Number)
	return (hours ?? 0) * 60 + (minutes ?? 0)
}

/** Whether `nowMs` (local time) falls in the user's quiet hours; a window may span midnight. */
export const isInQuietHours = (
	quietHoursStart: string | null,
	quietHoursEnd: string | null,
	nowMs: number,
): boolean => {
	if (!quietHoursStart || !quietHoursEnd) return false
	const now = new Date(nowMs)
	const current = now.getHours() * 60 + now.getMinutes()
	const start = minutesOfDay(quietHoursStart)
	const end = minutesOfDay(quietHoursEnd)
	if (start === end) return false
	return start < end ? current >= start && current < end : current >= start || current < end
}

export interface SoundMuteInputs {
	readonly settings: SoundSettings | null
	readonly doNotDisturb: boolean
	readonly quietHoursStart: string | null
	readonly quietHoursEnd: string | null
	readonly nowMs: number
}

/** Sounds are muted when disabled, in do not disturb, or during quiet hours. */
export const isSoundMuted = ({
	settings,
	doNotDisturb,
	quietHoursStart,
	quietHoursEnd,
	nowMs,
}: SoundMuteInputs) =>
	!settings?.enabled || doNotDisturb || isInQuietHours(quietHoursStart, quietHoursEnd, nowMs)
