import { Atom } from "effect/reactivity"
import { Schema } from "effect"
import { platformStorageRuntime } from "~/lib/platform-storage"

export const MAX_RECENT_CHANNELS = 8

/**
 * Schema for a single recent channel entry
 */
const RecentChannelSchema = Schema.Struct({
	channelId: Schema.String,
	visitedAt: Schema.Number,
})

export type RecentChannel = typeof RecentChannelSchema.Type

/**
 * Schema for the array of recent channels
 */
const RecentChannelsSchema = Schema.Array(RecentChannelSchema)

/**
 * Atom that stores recent channels in localStorage
 * Automatically persists changes - no manual localStorage calls needed
 */
export const recentChannelsAtom = Atom.kvs({
	runtime: platformStorageRuntime,
	key: "recentChannels",
	schema: Schema.toCodecIso(RecentChannelsSchema),
	defaultValue: () => [] as RecentChannel[],
}).pipe(Atom.keepAlive)
