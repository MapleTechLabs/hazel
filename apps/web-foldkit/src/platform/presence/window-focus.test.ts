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

	const fiber = Effect.runFork(windowFocus.pipe(Stream.take(4), Stream.runCollect))
	await new Promise((resolve) => setTimeout(resolve, 0))

	hasFocus.mockReturnValue(false)
	window.dispatchEvent(new Event("blur"))
	await new Promise((resolve) => setTimeout(resolve, 0))

	hasFocus.mockReturnValue(true)
	window.dispatchEvent(new Event("focus"))
	await new Promise((resolve) => setTimeout(resolve, 0))

	visibility.mockReturnValue("hidden")
	document.dispatchEvent(new Event("visibilitychange"))

	expect(Array.from(await Effect.runPromise(Fiber.join(fiber)))).toEqual([true, false, true, false])
})
