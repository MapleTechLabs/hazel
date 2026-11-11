import { describe, expect, it } from "@effect/vitest"
import { SLACK_EMOJI_ROWS } from "./emoji-data.generated"
import { slackEmojiToUnicode, unicodeToSlackEmoji } from "./emoji"

describe("slackEmojiToUnicode", () => {
	it("knows every alias of an emoji", () => {
		expect(slackEmojiToUnicode("+1")).toBe("👍")
		expect(slackEmojiToUnicode("thumbsup")).toBe("👍")
		expect(slackEmojiToUnicode(":thumbsup:")).toBe("👍")
		expect(slackEmojiToUnicode("heart")).toBe("❤️")
		expect(slackEmojiToUnicode("joy")).toBe("😂")
	})

	it("applies skin tones", () => {
		expect(slackEmojiToUnicode("thumbsup::skin-tone-2")).toBe("👍🏻")
		expect(slackEmojiToUnicode("+1::skin-tone-3")).toBe("👍🏼")
		expect(slackEmojiToUnicode("wave::skin-tone-6")).toBe("👋🏿")
		// The VS16 after the base gives way to the modifier.
		expect(slackEmojiToUnicode("point_up::skin-tone-2")).toBe("☝🏻")
		// A ZWJ sequence takes the modifier after its first code point.
		expect(slackEmojiToUnicode("man-raising-hand::skin-tone-4")).toBe("🙋🏽‍♂️")
		// One tone per person.
		expect(slackEmojiToUnicode("people_holding_hands::skin-tone-5")).toBe("🧑🏾‍🤝‍🧑🏾")
	})

	it("ignores a skin tone on an emoji that takes none", () => {
		expect(slackEmojiToUnicode("joy::skin-tone-3")).toBe("😂")
	})

	it("is null for custom and unknown emoji", () => {
		expect(slackEmojiToUnicode("party-parrot")).toBeNull()
		expect(slackEmojiToUnicode("")).toBeNull()
		expect(slackEmojiToUnicode("toString")).toBeNull()
	})
})

describe("unicodeToSlackEmoji", () => {
	it("gives Slack's canonical name", () => {
		expect(unicodeToSlackEmoji("👍")).toBe("+1")
		expect(unicodeToSlackEmoji("😂")).toBe("joy")
		expect(unicodeToSlackEmoji("🇫🇷")).toBe("fr")
		expect(slackEmojiToUnicode("flag-fr")).toBe("🇫🇷")
	})

	it("matches with or without the variation selector", () => {
		expect(unicodeToSlackEmoji("❤️")).toBe("heart")
		expect(unicodeToSlackEmoji("❤")).toBe("heart")
	})

	it("names skin tones", () => {
		expect(unicodeToSlackEmoji("👍🏼")).toBe("+1::skin-tone-3")
		expect(unicodeToSlackEmoji("☝🏻")).toBe("point_up::skin-tone-2")
		expect(unicodeToSlackEmoji("🧑🏾‍🤝‍🧑🏾")).toBe("people_holding_hands::skin-tone-5")
	})

	it("is null for text that is not an emoji", () => {
		expect(unicodeToSlackEmoji("x")).toBeNull()
		expect(unicodeToSlackEmoji("")).toBeNull()
	})

	it("round trips every emoji and skin tone in the table", () => {
		for (const [names, emoji, tones] of SLACK_EMOJI_ROWS) {
			const name = unicodeToSlackEmoji(emoji)
			expect(name).not.toBeNull()
			expect(slackEmojiToUnicode(name ?? "")).toBe(emoji)
			if (tones === undefined) continue
			for (let tone = 2; tone <= 6; tone++) {
				const toned = slackEmojiToUnicode(`${names.split(" ")[0]}::skin-tone-${tone}`)
				expect(toned).not.toBeNull()
				expect(slackEmojiToUnicode(unicodeToSlackEmoji(toned ?? "") ?? "")).toBe(toned)
			}
		}
	})
})
