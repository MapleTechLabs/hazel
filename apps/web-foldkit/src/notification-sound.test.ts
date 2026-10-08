// @vitest-environment jsdom
import { UserId } from "@hazel/schema"
import { Effect, Fiber, Schema, Stream } from "effect"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { notificationSoundManager } from "~/lib/notification-sound-manager"
import { wireNotificationSinks } from "./app/notification-sinks"
import { DEFAULT_SOUND_SETTINGS, loadSoundSettings, saveSoundSettings } from "./notification-sound"

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

describe("notification sinks", () => {
	test("Test sound plays with the wired settings, and is not ready before", async () => {
		const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
		expect((await notificationSoundManager.testSound()).reason).toBe("not_ready")

		const settings = { ...DEFAULT_SOUND_SETTINGS, volume: 0.3, soundFile: "notification03" as const }
		const fiber = Effect.runFork(
			Stream.runDrain(wireNotificationSinks({ userId: ada, settings, currentChannelId: null, sessionStartMs: 0 })),
		)
		await Effect.runPromise(Effect.yieldNow)
		const result = await notificationSoundManager.testSound()
		await Effect.runPromise(Fiber.interrupt(fiber))

		expect(result.status).toBe("sent")
		expect(play).toHaveBeenCalled()
	})
})
