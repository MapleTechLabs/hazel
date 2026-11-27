/**
 * The emojis this device picked last, newest first: the picker's "Recently used" row (today's
 * `web-foldkit/src/emoji-picker/recent.ts`, same key and shape). A custom emoji keeps its image.
 */
import { Option, Schema } from "effect"

export const RecentEmoji = Schema.Struct({
	emoji: Schema.String,
	label: Schema.String,
	imageUrl: Schema.NullOr(Schema.String),
})
export type RecentEmoji = typeof RecentEmoji.Type

/** Two rows of today's nine columns. */
export const MAX_RECENT_EMOJIS = 18

export const RECENT_EMOJIS_KEY = "hazel-recent-emojis"

const Stored = Schema.fromJsonString(Schema.Array(RecentEmoji))

/** The stored list; a missing or undecodable one is empty. */
export const decodeRecentEmojis = (text: string | null): ReadonlyArray<RecentEmoji> =>
	text === null ? [] : Option.getOrElse(Schema.decodeOption(Stored)(text), () => [])

export const encodeRecentEmojis = (recent: ReadonlyArray<RecentEmoji>): string => JSON.stringify(recent)

/** `emoji` moved (or added) to the front, without duplicates, capped at `MAX_RECENT_EMOJIS`. */
export const withRecentEmoji = (
	recent: ReadonlyArray<RecentEmoji>,
	emoji: RecentEmoji,
): ReadonlyArray<RecentEmoji> =>
	[emoji, ...recent.filter((entry) => entry.emoji !== emoji.emoji)].slice(0, MAX_RECENT_EMOJIS)
