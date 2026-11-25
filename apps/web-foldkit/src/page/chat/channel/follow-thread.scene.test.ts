// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { channelScene, derivedModel, mountedChannel } from "../../../test/chat-fixtures"
import { ToggleFollowThread } from "./clear-notifications"
import { ada, loadedModel } from "./fixtures.test-support"
import { Message } from "./model"

/** The page of a thread the user does not follow: its header offers Follow. */

describe("a thread page the user does not follow", () => {
	test("offers Follow in the header", () => {
		const base = loadedModel()
		const thread = derivedModel({
			...base,
			channel: base.channel === null ? null : { ...base.channel, type: "thread" },
			members: (base.members ?? []).filter((member) => member.userId !== ada),
		})
		Scene.scene(
			channelScene,
			Scene.given(thread),
			mountedChannel(null, false),
			Scene.expect(Scene.role("button", { name: "Follow thread" })).toExist(),
			Scene.click(Scene.role("button", { name: "Follow thread" })),
			Scene.Command.resolve(
				ToggleFollowThread,
				Message.CompletedToggleFollowThread({ isFollowing: true, isSuccess: true }),
			),
		)
	})
})
