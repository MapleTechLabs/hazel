import { Atom } from "effect/reactivity"
import { Schema } from "effect"
import { platformStorageRuntime } from "~/lib/platform-storage"

/**
 * Default emojis to show when no usage data exists
 */
const DEFAULT_EMOJIS = ["👍", "❤️", "😂", "🔥", "👀", "🎉"] as const

/**
 * Schema for emoji usage data
 * Maps emoji string to usage count
 */
const EmojiUsageSchema = Schema.Record(Schema.String, Schema.Number)

export type EmojiUsage = typeof EmojiUsageSchema.Type

/**
 * Atom that stores emoji usage data in localStorage
 */
export const emojiUsageAtom = Atom.kvs({
	runtime: platformStorageRuntime,
	key: "hazel-emoji-usage",
	schema: Schema.toCodecIso(EmojiUsageSchema),
	defaultValue: () => ({}) as EmojiUsage,
})

/**
 * Derived atom that computes the top 6 most used emojis
 */
export const topEmojisAtom = Atom.make((get) => {
	const emojiUsage = get(emojiUsageAtom)

	// Always return DEFAULT_EMOJIS if no usage data
	if (!emojiUsage || Object.keys(emojiUsage).length === 0) {
		return [...DEFAULT_EMOJIS]
	}

	const entries = Object.entries(emojiUsage)
	const sorted = entries.sort((a, b) => b[1] - a[1])
	const topEmojis = sorted.slice(0, 6).map(([emoji]) => emoji)

	// Fill with defaults if we don't have 6 yet
	if (topEmojis.length < 6) {
		const remainingDefaults = DEFAULT_EMOJIS.filter((emoji) => !topEmojis.includes(emoji))
		return [...topEmojis, ...remainingDefaults].slice(0, 6)
	}

	return topEmojis
}).pipe(Atom.keepAlive)

// trackEmojiUsage is now provided via useEmojiStats hook
// resetEmojiStats is now provided via useEmojiStats hook
