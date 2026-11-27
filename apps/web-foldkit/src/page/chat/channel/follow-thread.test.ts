import { describe, expect, test, vi } from "vitest"
import { loadedModel, updateWithShared } from "./fixtures.test-support"
import { Message } from "./model"

/** Following a thread from the thread panel: the toast its result shows. */

vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const threadPage = () => {
	const model = loadedModel()
	return {
		...model,
		channel: model.channel === null ? null : { ...model.channel, type: "thread" as const },
	}
}

describe("following a thread", () => {
	test("the result says what happened", () => {
		const done = updateWithShared(
			threadPage(),
			Message.CompletedToggleFollowThread({ isFollowing: true, isSuccess: true }),
		)
		expect(done.outMessage?._tag).toBe("RequestedToast")
	})
})
