import { ChannelId, ChannelMemberId, ChannelSectionId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { channelResetOf, isChannelOverride, isInEffect, summaryOf, type Override } from "./overrides"

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

	test("a channel's Reset clears everything that lists it, and DMs are never listed", () => {
		const memberId = ChannelMemberId.make("00000000-0000-4000-8000-000000000001")
		const settings = { type: "public", level: null, isMuted: false, mutedUntil: null }
		const set = [
			{ ...settings, level: "nothing" as const },
			{ ...settings, isMuted: true },
			{ ...settings, mutedUntil: new Date(now + 60_000) },
		]
		for (const row of set) {
			expect(isChannelOverride(row)).toBe(true)
			const reset = channelResetOf(memberId)
			expect(
				isChannelOverride({
					type: row.type,
					level: reset.notificationLevel,
					isMuted: reset.isMuted,
					mutedUntil: reset.mutedUntil,
				}),
			).toBe(false)
		}
		expect(isChannelOverride({ ...settings, type: "direct", isMuted: true })).toBe(false)
		expect(isChannelOverride({ ...settings, type: "single", level: "all" })).toBe(false)
	})
})
