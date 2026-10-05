/**
 * @module Notification Sound Atoms
 * @description Atoms for notification sound system state management
 */

import { Atom } from "effect/reactivity"
import { Schema } from "effect"
import { platformStorageRuntime } from "~/lib/platform-storage"

/**
 * Session initialization timestamp - notifications before this are "old"
 * and should not trigger sounds (prevents sounds on app startup)
 */
export const sessionStartTimeAtom = Atom.make<Date>(new Date()).pipe(Atom.keepAlive)

/**
 * Notification sound settings schema and atom
 */
export interface NotificationSoundSettings {
	enabled: boolean
	volume: number
	soundFile: "notification01" | "notification03"
	cooldownMs: number
}

const NotificationSoundSettingsSchema = Schema.Struct({
	enabled: Schema.Boolean,
	volume: Schema.Number,
	soundFile: Schema.Literals(["notification01", "notification03"]),
	cooldownMs: Schema.Number,
})

const DEFAULT_SETTINGS: NotificationSoundSettings = {
	enabled: true,
	volume: 0.5,
	soundFile: "notification01",
	cooldownMs: 1000,
}

export const notificationSoundSettingsAtom = Atom.kvs({
	runtime: platformStorageRuntime,
	key: "notification-sound-settings",
	schema: Schema.toCodecIso(Schema.NullOr(NotificationSoundSettingsSchema)),
	defaultValue: () => DEFAULT_SETTINGS,
})

const parseTimeToMinutes = (time: string): number => {
	const [hours, minutes] = time.split(":").map(Number)
	return (hours ?? 0) * 60 + (minutes ?? 0)
}

/**
 * Check if current time is within quiet hours.
 * Evaluates at READ time (not subscription time) for accurate results.
 */
export const isInQuietHours = (quietHoursStart: string | null, quietHoursEnd: string | null): boolean => {
	if (!quietHoursStart || !quietHoursEnd) {
		return false
	}

	const now = new Date()
	const currentMinutes = now.getHours() * 60 + now.getMinutes()
	const start = parseTimeToMinutes(quietHoursStart)
	const end = parseTimeToMinutes(quietHoursEnd)

	if (start === end) {
		return false
	}

	if (start < end) {
		return currentMinutes >= start && currentMinutes < end
	}
	return currentMinutes >= start || currentMinutes < end
}

/**
 * Computed getter that determines if sounds should be muted.
 */
export const createIsMutedGetter = (
	settings: NotificationSoundSettings | null,
	doNotDisturb: boolean | null,
	quietHoursStart: string | null,
	quietHoursEnd: string | null,
): (() => boolean) => {
	return () => {
		if (!settings?.enabled) {
			return true
		}

		if (doNotDisturb) {
			return true
		}

		if (isInQuietHours(quietHoursStart, quietHoursEnd)) {
			return true
		}

		return false
	}
}
