import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	NotificationSoundManager,
	type NotificationSoundDependencies,
	type PlaySoundParams,
} from "./notification-sound-manager"

vi.mock("./tauri", () => ({
	isTauri: vi.fn(() => false),
}))

describe("NotificationSoundManager", () => {
	let manager: NotificationSoundManager
	let mockAudio: {
		play: ReturnType<typeof vi.fn>
		pause: ReturnType<typeof vi.fn>
		volume: number
		src: string
		currentTime: number
	}
	let mockDependencies: NotificationSoundDependencies

	beforeEach(() => {
		vi.clearAllMocks()
		manager = new NotificationSoundManager()

		mockAudio = {
			play: vi.fn().mockResolvedValue(undefined),
			pause: vi.fn(),
			volume: 0.5,
			src: "",
			currentTime: 0,
		}

		;(manager as any).audioElement = mockAudio
		;(manager as any).isPrimed = true

		mockDependencies = {
			getConfig: vi.fn(() => ({
				soundFile: "notification01" as const,
				volume: 0.5,
				cooldownMs: 1000,
			})),
		}

		manager.setDependencies(mockDependencies)
	})

	afterEach(() => {
		manager.dispose()
	})

	const createParams = (overrides: Partial<PlaySoundParams> = {}): PlaySoundParams => ({
		notificationId: "test-notification-1",
		...overrides,
	})

	it("returns suppressed:not_ready when dependencies are missing", async () => {
		const newManager = new NotificationSoundManager()
		;(newManager as any).audioElement = mockAudio
		;(newManager as any).isPrimed = true

		const result = await newManager.playSound(createParams())
		expect(result.status).toBe("suppressed")
		expect(result.reason).toBe("not_ready")
	})

	it("suppresses duplicate notification IDs", async () => {
		const params = createParams()
		await manager.playSound(params)

		const result = await manager.playSound(params)
		expect(result.status).toBe("suppressed")
		expect(result.reason).toBe("duplicate")
	})

	it("suppresses playback during cooldown", async () => {
		await manager.playSound(createParams({ notificationId: "a" }))
		const result = await manager.playSound(createParams({ notificationId: "b" }))
		expect(result.status).toBe("suppressed")
		expect(result.reason).toBe("cooldown")
	})

	it("plays audio when ready", async () => {
		const result = await manager.playSound(createParams())

		expect(result.status).toBe("sent")
		expect(result.reason).toBe("ok")
		expect(mockAudio.play).toHaveBeenCalled()
		expect(mockAudio.src).toBe("/sounds/notification01.mp3")
	})

	it("returns failed:error when playback throws", async () => {
		mockAudio.play.mockRejectedValueOnce(new Error("Audio failed"))
		const result = await manager.playSound(createParams())

		expect(result.status).toBe("failed")
		expect(result.reason).toBe("error")
		expect((manager as any).playedIds.has("test-notification-1")).toBe(false)
	})

	it("testSound returns suppressed:not_ready when deps missing", async () => {
		const newManager = new NotificationSoundManager()
		;(newManager as any).audioElement = mockAudio
		const result = await newManager.testSound()

		expect(result.status).toBe("suppressed")
		expect(result.reason).toBe("not_ready")
	})

	it("testSound plays current configured sound", async () => {
		mockDependencies.getConfig = vi.fn(() => ({
			soundFile: "notification03" as const,
			volume: 0.8,
			cooldownMs: 1000,
		}))
		manager.setDependencies(mockDependencies)

		const result = await manager.testSound()

		expect(result.status).toBe("sent")
		expect(mockAudio.src).toBe("/sounds/notification03.mp3")
		expect(mockAudio.volume).toBe(0.8)
	})

	it("compacts played IDs when max is exceeded", async () => {
		const playedIds = (manager as any).playedIds as Set<string>
		for (let i = 0; i < 1100; i++) {
			playedIds.add(`old-${i}`)
		}
		;(manager as any).lastPlayedAt = 0

		await manager.playSound(createParams({ notificationId: "new-id" }))
		expect(playedIds.size).toBeLessThanOrEqual(601)
	})
})
