/**
 * Which Discord channels are threads: the channel each lives in, its name and who started it. A
 * thread's events name only the thread, but Hazel routes them by their parent channel (like Slack's
 * replies), so a thread's first message never waits on its own link being indexed. Learned from the
 * gateway (`GUILD_CREATE`, `THREAD_CREATE`, `THREAD_UPDATE`, `THREAD_LIST_SYNC`, `CHANNEL_CREATE`),
 * else asked of Discord once per channel.
 */
import { ExternalChannelId } from "@hazel/schema"
import { Cause, Effect, Option, Schema } from "effect"

/** Public and private threads: the ones `THREAD_CREATE` links (`gateway-dispatch.ts`). */
const THREAD_TYPES = new Set([11, 12])

/** Past this many channels the map starts over; it refills from events and lookups. */
const MAX_KNOWN = 50_000

export interface DiscordChannelInfo {
	readonly id?: string
	readonly type?: number
	readonly parent_id?: string | null
	readonly name?: string | null
	readonly owner_id?: string | null
}

export interface DiscordThreadInfo {
	readonly parentId: ExternalChannelId
	readonly name: string | null
	/** Who started it; our bot for a thread mirrored from Hazel. */
	readonly ownerId: string | null
}

const decodeChannelId = Schema.decodeUnknownOption(ExternalChannelId)

/** The channel as a thread; none for a channel that is not one. */
const threadOf = (channel: DiscordChannelInfo): Option.Option<DiscordThreadInfo> =>
	channel.type !== undefined && THREAD_TYPES.has(channel.type)
		? Option.map(decodeChannelId(channel.parent_id), (parentId) => ({
				parentId,
				name: channel.name?.trim() || null,
				ownerId: channel.owner_id ?? null,
			}))
		: Option.none()

export const makeDiscordThreadParents = <E>(
	/** Discord's answer for a channel this session has not seen. */
	fetchChannel: (channelId: string) => Effect.Effect<DiscordChannelInfo, E>,
) => {
	const known = new Map<string, Option.Option<DiscordThreadInfo>>()

	const remember = (channel: DiscordChannelInfo) => {
		if (!channel.id) return
		if (known.size >= MAX_KNOWN) known.clear()
		known.set(channel.id, threadOf(channel))
	}

	return {
		remember,
		rememberAll: (channels: ReadonlyArray<DiscordChannelInfo> | undefined) => {
			for (const channel of channels ?? []) remember(channel)
		},
		/**
		 * `channelId` as a thread, when it is one. A failed lookup is logged, not remembered, and
		 * routes the event by its own channel (a thread's link is still indexed by its id).
		 */
		threadOf: Effect.fn("DiscordThreadParents.threadOf")(function* (channelId: string) {
			const cached = known.get(channelId)
			if (cached !== undefined) return cached
			yield* Effect.annotateCurrentSpan({ "discord.channel_id": channelId })
			return yield* fetchChannel(channelId).pipe(
				Effect.map((channel) => {
					remember({ ...channel, id: channelId })
					return threadOf(channel)
				}),
				Effect.catch((error) =>
					Effect.logWarning(
						"Discord channel lookup failed; routing by the channel itself",
						Cause.fail(error),
						{ channelId },
					).pipe(Effect.as(Option.none<DiscordThreadInfo>())),
				),
			)
		}),
	}
}
