import { ChannelId, NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { uuid } from "../../../test/pages-fixtures"
import { mentionedUserIds, plainTextOf, previewOf, unreadChannelDetail } from "./format"
import type { NotificationItem, UnreadChannelItem } from "./model"

const ada = uuid(70)
const grace = uuid(71)

const item = (
	messageContent: string | null,
	mentionNames: Record<string, string> = {},
): NotificationItem => ({
	id: Schema.decodeSync(NotificationId)(uuid(1)),
	isUnread: true,
	createdAtMs: 0,
	resourceType: "message",
	reason: "mention",
	targetedResourceId: uuid(900),
	targetedResourceType: "channel",
	messageContent,
	mentionNames,
	channel: { name: "general", type: "public" },
	author: null,
})

describe("plainTextOf", () => {
	test("names mentioned users, falling back to @unknown", () => {
		expect(plainTextOf(`@[userId:${ada}] inbox mention check`, { [ada]: "Ada Lovelace" })).toBe(
			"@Ada Lovelace inbox mention check",
		)
		expect(plainTextOf(`hi @[userId:${grace}]`, {})).toBe("hi @unknown")
	})

	test("directives read as @channel and @here, groups as their name or @group", () => {
		expect(plainTextOf("@[directive:channel] and @[directive:here]", {})).toBe("@channel and @here")
		expect(plainTextOf(`ping @[group:${uuid(5)}]`, {})).toBe("ping @group")
		expect(plainTextOf(`ping @[group:${uuid(5)}]`, { [uuid(5)]: "design" })).toBe("ping @design")
	})

	test("drops markdown markers, links and line breaks", () => {
		expect(plainTextOf("> **Ship** it\n\n`now` [here](https://x.dev) ~~not~~", {})).toBe(
			"Ship it now here not",
		)
	})
})

describe("mentionedUserIds", () => {
	test("lists each mentioned user once, not directives or groups", () => {
		expect(
			mentionedUserIds(`@[userId:${ada}] @[userId:${grace}] @[userId:${ada}] @[directive:here]`),
		).toEqual([ada, grace])
	})
})

describe("previewOf", () => {
	test("renders mentions by name", () => {
		expect(previewOf(item(`@[userId:${ada}] can you look?`, { [ada]: "Ada Lovelace" }))).toBe(
			"@Ada Lovelace can you look?",
		)
	})

	test("truncates by code point with an ellipsis", () => {
		expect(previewOf(item("😀".repeat(10)), 4)).toBe("😀😀😀😀…")
		expect(previewOf(item("short"), 80)).toBe("short")
	})

	test("a message with no text left reads as a notification", () => {
		expect(previewOf(item("**  **"))).toBe("View notification")
		expect(previewOf(item(null))).toBe("View notification")
	})
})

describe("unreadChannelDetail", () => {
	const channel = (mentionCount: number): UnreadChannelItem => ({
		channelId: Schema.decodeSync(ChannelId)(uuid(800)),
		name: "general",
		type: "public",
		mentionCount,
		lastMessageAtMs: 0,
		mutedUntilMs: null,
	})

	test("counts mentions in the singular and plural, none without a count", () => {
		expect(unreadChannelDetail(channel(0))).toBe("New messages")
		expect(unreadChannelDetail(channel(1))).toBe("1 mention")
		expect(unreadChannelDetail(channel(2))).toBe("2 mentions")
	})
})
