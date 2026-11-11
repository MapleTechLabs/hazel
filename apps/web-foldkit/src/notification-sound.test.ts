// @vitest-environment jsdom
import { UserId } from "@hazel/schema"
import { Effect, Fiber, Schema, Stream } from "effect"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { notificationSoundManager } from "~/lib/notification-sound-manager"
import { NotificationSinks, wireNotificationSinks } from "./app/notification-sinks"
import {
	DEFAULT_SOUND_SETTINGS,
	isInQuietHours,
	isSoundMuted,
	loadSoundSettings,
	saveSoundSettings,
} from "./notification-sound"

/** The root's notification sound wiring (legacy `NotificationSoundProvider`) and its stored settings. */

const ada = Schema.decodeSync(UserId)("00000000-0000-4000-8000-000000000001")

describe("sound settings", () => {
	beforeEach(() => localStorage.clear())

	test("default until stored, then the legacy atom's key", async () => {
		expect(await Effect.runPromise(loadSoundSettings)).toEqual(DEFAULT_SOUND_SETTINGS)
		const quiet = { ...DEFAULT_SOUND_SETTINGS, volume: 0.2, soundFile: "notification03" as const }
		await Effect.runPromise(saveSoundSettings(quiet))
		expect(localStorage.getItem("notification-sound-settings")).not.toBeNull()
		expect(await Effect.runPromise(loadSoundSettings)).toEqual(quiet)
	})
})

describe("quiet hours", () => {
	const at = (time: string) => new Date(`2025-01-01T${time}:00`).getTime()

	test("off when not configured", () => {
		expect(isInQuietHours(null, "08:00", at("23:00"))).toBe(false)
		expect(isInQuietHours("22:00", null, at("23:00"))).toBe(false)
	})

	test("minute precision within a day", () => {
		expect(isInQuietHours("10:15", "10:45", at("10:30"))).toBe(true)
		expect(isInQuietHours("10:31", "10:45", at("10:30"))).toBe(false)
	})

	test("a window spanning midnight", () => {
		expect(isInQuietHours("22:15", "06:45", at("23:30"))).toBe(true)
		expect(isInQuietHours("22:15", "06:45", at("12:00"))).toBe(false)
	})

	test("sounds mute when disabled, in do not disturb, or in quiet hours", () => {
		const inputs = {
			settings: DEFAULT_SOUND_SETTINGS,
			doNotDisturb: false,
			quietHoursStart: "22:00",
			quietHoursEnd: "08:00",
			nowMs: at("12:00"),
		}
		expect(isSoundMuted(inputs)).toBe(false)
		expect(isSoundMuted({ ...inputs, settings: { ...DEFAULT_SOUND_SETTINGS, enabled: false } })).toBe(
			true,
		)
		expect(isSoundMuted({ ...inputs, doNotDisturb: true })).toBe(true)
		expect(isSoundMuted({ ...inputs, nowMs: at("23:00") })).toBe(true)
	})
})

describe("notification sinks", () => {
	test("Test sound plays with the wired settings, and is not ready before", async () => {
		const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
		expect((await notificationSoundManager.testSound()).reason).toBe("not_ready")

		const settings = { ...DEFAULT_SOUND_SETTINGS, volume: 0.3, soundFile: "notification03" as const }
		const fiber = Effect.runFork(
			Stream.runDrain(
				wireNotificationSinks({ userId: ada, settings, currentChannelId: null, sessionStartMs: 0 }),
			).pipe(Effect.provide(NotificationSinks.layer)),
		)
		await Effect.runPromise(Effect.yieldNow)
		const result = await notificationSoundManager.testSound()
		await Effect.runPromise(Fiber.interrupt(fiber))

		expect(result.status).toBe("sent")
		expect(play).toHaveBeenCalled()
	})
})
