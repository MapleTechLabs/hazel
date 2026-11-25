import { describe, expect, test, vi } from "vitest"
import { channelId, loadedModel, updateWithShared } from "./fixtures.test-support"
import { ToggleFollowThread } from "./clear-notifications"
import { Message } from "./model"

/** Following a thread from its page, and the toast its result shows. */

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
	test("the thread page's Follow joins it", () => {
		const followed = updateWithShared(threadPage(), Message.ClickedFollowThread())
		expect(followed.commands?.map((command) => [command.name, command.args])).toEqual([
			[ToggleFollowThread.name, { threadChannelId: channelId, memberId: null }],
		])
	})

	test("a channel page has nothing to follow", () => {
		expect(updateWithShared(loadedModel(), Message.ClickedFollowThread()).commands ?? []).toEqual([])
	})

	test("the result says what happened", () => {
		const done = updateWithShared(
			threadPage(),
			Message.CompletedToggleFollowThread({ isFollowing: true, isSuccess: true }),
		)
		expect(done.outMessage?._tag).toBe("RequestedToast")
	})
})
