// @vitest-environment jsdom
import { Effect, Fiber, Stream } from "effect"
import { afterEach, expect, test, vi } from "vitest"
import { windowFocus } from "./activity"

/** The focus signal presence uses to stop claiming the open channel while the window is in the background. */

afterEach(() => {
	vi.restoreAllMocks()
})

test("emits the state on start, then re-reads it on blur, focus and visibility changes", async () => {
	const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true)
	const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")

	// The state is read when the event reaches the stream, so each change waits for the value
	// before it: a fixed delay raced it, and a later mock leaked into an earlier read.
	const seen: Array<boolean> = []
	const fiber = Effect.runFork(
		windowFocus.pipe(
			Stream.take(4),
			Stream.runForEach((focused) => Effect.sync(() => seen.push(focused))),
		),
	)
	const emitted = (count: number) => vi.waitFor(() => expect(seen).toHaveLength(count))
	await emitted(1)

	hasFocus.mockReturnValue(false)
	window.dispatchEvent(new Event("blur"))
	await emitted(2)

	hasFocus.mockReturnValue(true)
	window.dispatchEvent(new Event("focus"))
	await emitted(3)

	visibility.mockReturnValue("hidden")
	document.dispatchEvent(new Event("visibilitychange"))
	await emitted(4)
	await Effect.runPromise(Fiber.join(fiber))

	expect(seen).toEqual([true, false, true, false])
})
