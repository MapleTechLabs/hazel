// @vitest-environment jsdom
import { Effect, Stream } from "effect"
import { Mount } from "foldkit"
import { expect, test, vi } from "vitest"
import { TwinkleStar } from "./globe"

/** The star's animation repeats forever, so leaving the DOM must cancel it. */

test("a twinkling star cancels its animation when its Mount is released", async () => {
	const cancel = vi.fn()
	const element = document.createElement("div")
	const animate = vi.fn(() => ({ cancel }))
	// jsdom has no Web Animations API.
	Reflect.set(element, "animate", animate)
	const action = TwinkleStar({ delay: 0, isVisible: true })
	await Effect.runPromise(Stream.runHead(action.f(element, Mount.liveViewStateChanges)))
	expect(animate).toHaveBeenCalledOnce()
	expect(cancel).toHaveBeenCalledOnce()
})
