import { describe, expect, it } from "vitest"
import { parseMentions } from "./mention-parser"

describe("parseMentions", () => {
	it("reads users, groups and directives", () => {
		const user = "11111111-1111-4111-8111-111111111111"
		const group = "22222222-2222-4222-8222-222222222222"
		expect(
			parseMentions(`hi @[userId:${user}] and @[group:${group}], @[group:${group}] @[directive:here]`),
		).toEqual({
			userMentions: [user],
			groupMentions: [group],
			hasChannelMention: false,
			hasHereMention: true,
		})
	})

	it("finds nothing in plain text", () => {
		expect(parseMentions("@design is not a mention")).toEqual({
			userMentions: [],
			groupMentions: [],
			hasChannelMention: false,
			hasHereMention: false,
		})
	})
})
