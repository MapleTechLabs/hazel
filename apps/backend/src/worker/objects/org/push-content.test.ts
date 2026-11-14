import { describe, expect, it } from "vitest"
import { displayNameOf, PUSH_BODY_MAX, pushBody, pushPath, pushTitle } from "./push-content"
import type { ChannelId } from "@hazel/schema"

const names = new Map([["u-1", "Grace Hopper"]])

describe("push content", () => {
	it("titles a channel, a DM, a group DM and a thread", () => {
		expect(pushTitle("Ada", { type: "public", name: "general" }, undefined)).toBe("Ada · #general")
		expect(pushTitle("Ada", { type: "private", name: "core" }, undefined)).toBe("Ada · #core")
		expect(pushTitle("Ada", { type: "single", name: "Ada, Grace" }, undefined)).toBe("Ada")
		expect(pushTitle("Ada", { type: "direct", name: "Ada, Grace, Alan" }, undefined)).toBe(
			"Ada · Ada, Grace, Alan",
		)
		expect(pushTitle("Ada", { type: "direct", name: "" }, undefined)).toBe("Ada")
		expect(
			pushTitle("Ada", { type: "thread", name: "Thread" }, { type: "public", name: "general" }),
		).toBe("Ada · thread in #general")
		expect(pushTitle("Ada", { type: "thread", name: "Thread" }, { type: "single", name: "x" })).toBe(
			"Ada · thread",
		)
	})

	it("names users, with a fallback", () => {
		expect(displayNameOf({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace")
		expect(displayNameOf({ firstName: " ", lastName: "" })).toBe("Someone")
		expect(displayNameOf(undefined)).toBe("Someone")
	})

	it("turns markup into plain text", () => {
		expect(pushBody("hey @[userId:u-1] and @[userId:u-2]", 0, names)).toBe(
			"hey @Grace Hopper and @someone",
		)
		expect(pushBody("@[directive:channel] **standup**\n\n> in 5", 0, names)).toBe("@channel standup in 5")
		expect(pushBody("see [the doc](https://x.test) and `code`", 0, names)).toBe("see the doc and code")
		expect(pushBody("```ts\nconst a = 1\n```", 0, names)).toBe("const a = 1")
	})

	it("shortens long messages and describes attachment-only ones", () => {
		const body = pushBody("a".repeat(500), 0, names)
		expect(body.length).toBe(PUSH_BODY_MAX)
		expect(body.endsWith("…")).toBe(true)
		const emoji = pushBody("😀".repeat(300), 0, names)
		expect(emoji).toBe(`${"😀".repeat(PUSH_BODY_MAX - 1)}…`)
		expect(pushBody("  ", 2, names)).toBe("Sent an attachment")
		expect(pushBody("", 0, names)).toBe("Sent a message")
	})

	it("links to the channel's route", () => {
		expect(pushPath("acme", "c-1" as ChannelId)).toBe("/acme/chat/c-1")
		expect(pushPath(null, "c-1" as ChannelId)).toBeUndefined()
	})
})
