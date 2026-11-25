import { ChannelId, ChannelMemberId, ChannelSectionId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { isInEffect, summaryOf, type Override } from "./overrides"

const now = Date.UTC(2026, 10, 25, 12)
const channel = (overrides: Partial<Extract<Override, { _tag: "Channel" }>> = {}): Override => ({
	_tag: "Channel",
	memberId: ChannelMemberId.make("00000000-0000-4000-8000-000000000001"),
	channelId: ChannelId.make("00000000-0000-4000-8000-000000000002"),
	name: "general",
	type: "public",
	level: null,
	isMuted: false,
	mutedUntilMs: null,
	...overrides,
})

describe("notification overrides", () => {
	test("say what the channel's own setting is", () => {
		expect(summaryOf(channel({ level: "all" }), now)).toBe("All messages")
		expect(summaryOf(channel({ level: "nothing", isMuted: true }), now)).toBe("Nothing · Muted")
		expect(summaryOf(channel({ mutedUntilMs: now + 3_600_000 }), now)).toMatch(/^Muted until /)
	})

	test("only settings still in effect are listed: an ended timed mute is none", () => {
		expect(isInEffect(channel({ mutedUntilMs: now - 1 }), now)).toBe(false)
		expect(isInEffect(channel({ mutedUntilMs: now + 1 }), now)).toBe(true)
		expect(isInEffect(channel({ level: "all", mutedUntilMs: now - 1 }), now)).toBe(true)
		expect(isInEffect(channel({ isMuted: true }), now)).toBe(true)
	})

	test("a timed mute that ended reads as the default", () => {
		expect(summaryOf(channel({ mutedUntilMs: now - 1 }), now)).toBe("Default")
		const section: Override = {
			_tag: "Section",
			sectionId: ChannelSectionId.make("00000000-0000-4000-8000-000000000003"),
			name: "Projects",
			level: "mentions",
			isMuted: false,
			mutedUntilMs: null,
		}
		expect(summaryOf(section, now)).toBe("Only @mentions")
	})
})
