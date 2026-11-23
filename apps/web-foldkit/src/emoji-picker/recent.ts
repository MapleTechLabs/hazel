import { Effect, Option, Schema } from "effect"
import { readStored, writeStored } from "../data/storage"

/**
 * The emojis this device picked last, newest first: the picker's "Recently used" row. Kept in the
 * platform store (localStorage, the Tauri store on desktop); a custom emoji keeps its image.
 */

export const RecentEmoji = Schema.Struct({
	emoji: Schema.String,
	label: Schema.String,
	imageUrl: Schema.NullOr(Schema.String),
})
export type RecentEmoji = typeof RecentEmoji.Type

/** Two rows of the picker's nine columns. */
export const MAX_RECENT_EMOJIS = 18

const STORAGE_KEY = "hazel-recent-emojis"
const StoredCodec = Schema.toCodecJson(Schema.Array(RecentEmoji))

/** The stored list; a missing, blocked or undecodable store has none. */
export const loadRecentEmojis: Effect.Effect<ReadonlyArray<RecentEmoji>> = readStored(
	STORAGE_KEY,
	StoredCodec,
).pipe(Effect.map(Option.getOrElse((): ReadonlyArray<RecentEmoji> => [])))

/** Best effort: a full or blocked store only forgets the pick. */
export const saveRecentEmojis = (recent: ReadonlyArray<RecentEmoji>): Effect.Effect<void> =>
	writeStored(STORAGE_KEY, StoredCodec, recent).pipe(Effect.ignore)

/** `emoji` moved (or added) to the front, without duplicates, capped at `MAX_RECENT_EMOJIS`. */
export const withRecentEmoji = (
	recent: ReadonlyArray<RecentEmoji>,
	emoji: RecentEmoji,
): ReadonlyArray<RecentEmoji> =>
	[emoji, ...recent.filter((entry) => entry.emoji !== emoji.emoji)].slice(0, MAX_RECENT_EMOJIS)
