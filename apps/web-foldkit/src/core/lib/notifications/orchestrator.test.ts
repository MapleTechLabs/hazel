import { describe, expect, it } from "vitest"
import { NotificationOrchestrator } from "./orchestrator"
import type { NotificationDecision, NotificationEvent, NotificationSink } from "./types"

class RecordingSink implements NotificationSink {
	public handled: Array<{ id: string; decision: NotificationDecision }> = []
	private readonly sink: "sound" | "native"

	constructor(sink: "sound" | "native") {
		this.sink = sink
	}

	async handle(event: NotificationEvent, decision: NotificationDecision) {
		this.handled.push({ id: event.id, decision })
		return {
			sink: this.sink,
			status: "sent" as const,
			reason: "ok" as const,
		}
	}
}

const waitFor = async (predicate: () => boolean) => {
	for (let i = 0; i < 40; i++) {
		if (predicate()) return
		await new Promise((resolve) => setTimeout(resolve, 5))
	}
	throw new Error("Timed out waiting for predicate")
}

const createEvent = (
	id: string,
	createdAt: string,
	channelId: string | null = null,
	silent = false,
): NotificationEvent => ({
	id,
	notification: {
		id,
		memberId: "member-1",
		targetedResourceId: channelId,
		targetedResourceType: channelId ? "channel" : null,
		resourceId: null,
		resourceType: null,
		createdAt: new Date(createdAt),
		readAt: null,
		reason: null,
		silent,
	} as any,
	receivedAt: Date.now(),
})

describe("NotificationOrchestrator", () => {
	it("processes events in chronological order", async () => {
		const sound = new RecordingSink("sound")
		const native = new RecordingSink("native")
		const orchestrator = new NotificationOrchestrator()

		orchestrator.setDependencies({
			getContext: () => ({
				currentChannelId: null,
				sessionStartTime: new Date("2024-01-01T00:00:00Z"),
				isMuted: false,
				isWindowFocused: false,
				visibilityState: "hidden",
				now: Date.now(),
			}),
			soundSink: sound,
			nativeSink: native,
		})

		orchestrator.enqueue([
			createEvent("n2", "2025-01-01T10:00:02Z"),
			createEvent("n1", "2025-01-01T10:00:01Z"),
		])

		await waitFor(() => sound.handled.length === 2)
		expect(sound.handled.map((h) => h.id)).toEqual(["n1", "n2"])
	})

	it("suppresses native notifications when focused", async () => {
		const sound = new RecordingSink("sound")
		const native = new RecordingSink("native")
		const orchestrator = new NotificationOrchestrator()

		orchestrator.setDependencies({
			getContext: () => ({
				currentChannelId: "channel-1",
				sessionStartTime: new Date("2024-01-01T00:00:00Z"),
				isMuted: false,
				isWindowFocused: true,
				visibilityState: "visible",
				now: Date.now(),
			}),
			soundSink: sound,
			nativeSink: native,
		})

		orchestrator.enqueue([createEvent("n1", "2025-01-01T10:00:01Z", "channel-2")])
		await waitFor(() => native.handled.length === 1)

		const decision = native.handled[0]?.decision
		expect(decision?.sendNative).toBe(false)
		expect(decision?.playSound).toBe(true)
	})

	it("deduplicates repeated events", async () => {
		const sound = new RecordingSink("sound")
		const native = new RecordingSink("native")
		const orchestrator = new NotificationOrchestrator()

		orchestrator.setDependencies({
			getContext: () => ({
				currentChannelId: null,
				sessionStartTime: new Date("2024-01-01T00:00:00Z"),
				isMuted: false,
				isWindowFocused: false,
				visibilityState: "hidden",
				now: Date.now(),
			}),
			soundSink: sound,
			nativeSink: native,
		})

		const event = createEvent("n1", "2025-01-01T10:00:01Z")
		orchestrator.enqueue([event])
		orchestrator.enqueue([event])

		await waitFor(() => sound.handled.length === 1)
		// Let a duplicate run, if it were going to.
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(sound.handled.length).toBe(1)
	})

	it("neither rings nor shows a silent notification (do not disturb on the server)", async () => {
		const sound = new RecordingSink("sound")
		const native = new RecordingSink("native")
		const orchestrator = new NotificationOrchestrator()

		orchestrator.setDependencies({
			getContext: () => ({
				currentChannelId: null,
				sessionStartTime: new Date("2024-01-01T00:00:00Z"),
				isMuted: false,
				isWindowFocused: false,
				visibilityState: "hidden",
				now: Date.now(),
			}),
			soundSink: sound,
			nativeSink: native,
		})

		orchestrator.enqueue([createEvent("n1", "2025-01-01T10:00:01Z", "channel-1", true)])
		await waitFor(() => native.handled.length === 1)

		const decision = native.handled[0]?.decision
		expect(decision?.playSound).toBe(false)
		expect(decision?.sendNative).toBe(false)
		expect(decision?.reasons).toContain("silent")
	})
})
