import { SLACK_EMOJI_ROWS } from "./emoji-data.generated.ts"

/** The Fitzpatrick modifiers for Slack's `skin-tone-2` .. `skin-tone-6`. */
const SKIN_TONE_MODIFIERS = ["\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"] as const
const VARIATION_SELECTOR_16 = "️"

interface EmojiTables {
	/** short name → [emoji, toned variants (index 0 = skin-tone-2)] */
	readonly byName: ReadonlyMap<string, readonly [string, ReadonlyArray<string> | null]>
	/** emoji without VS16 → Slack name (`+1`, `+1::skin-tone-3`) */
	readonly byEmoji: ReadonlyMap<string, string>
}

/** The modifier goes after the first code point, replacing a VS16 there (the dataset's rule). */
const withSkinTone = (emoji: string, modifier: string): string => {
	const [first = "", ...rest] = Array.from(emoji)
	const tail = rest[0] === VARIATION_SELECTOR_16 ? rest.slice(1) : rest
	return first + modifier + tail.join("")
}

const stripVariationSelector = (emoji: string): string => emoji.replaceAll(VARIATION_SELECTOR_16, "")

let tables: EmojiTables | undefined

/** Built on first use: about 3,500 entries. */
const emojiTables = (): EmojiTables => {
	if (tables) return tables
	const byName = new Map<string, readonly [string, ReadonlyArray<string> | null]>()
	const byEmoji = new Map<string, string>()
	const addEmoji = (emoji: string, name: string) => {
		const key = stripVariationSelector(emoji)
		if (!byEmoji.has(key)) byEmoji.set(key, name)
	}
	for (const [names, emoji, tones] of SLACK_EMOJI_ROWS) {
		const shortNames = names.split(" ")
		const canonical = shortNames[0] ?? names
		const toned =
			tones === undefined
				? null
				: tones === 1
					? SKIN_TONE_MODIFIERS.map((modifier) => withSkinTone(emoji, modifier))
					: tones
		for (const name of shortNames) {
			if (!byName.has(name)) byName.set(name, [emoji, toned])
		}
		addEmoji(emoji, canonical)
		toned?.forEach((variant, index) => addEmoji(variant, `${canonical}::skin-tone-${index + 2}`))
	}
	tables = { byName, byEmoji }
	return tables
}

/**
 * A Slack emoji name (a reaction's `name`, or `:name:`) to its unicode emoji: `thumbsup` and `+1`
 * give 👍, `thumbsup::skin-tone-3` gives 👍🏼. Null for a custom workspace emoji or an unknown name.
 */
export const slackEmojiToUnicode = (name: string): string | null => {
	const [base = "", ...modifiers] = name.trim().replace(/^:/, "").replace(/:$/, "").split("::")
	const entry = emojiTables().byName.get(base)
	if (!entry) return null
	const [emoji, toned] = entry
	const tone = modifiers.map((modifier) => /^skin-tone-([2-6])$/.exec(modifier)?.[1]).find(Boolean)
	if (!tone || !toned) return emoji
	return toned[Number(tone) - 2] ?? emoji
}

/**
 * A unicode emoji to Slack's canonical name: 👍 gives `+1`, 👍🏼 gives `+1::skin-tone-3`.
 * Matches with or without the variation selector (U+FE0F). Null when Slack has no name for it.
 */
export const unicodeToSlackEmoji = (emoji: string): string | null =>
	emojiTables().byEmoji.get(stripVariationSelector(emoji.trim())) ?? null
