// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The phone keeps the channels a person is most likely to open next syncing in the background:
 * those with unread notifications (mentions, DMs), then those with unread messages. Opening one then
 * finds its messages already in (in the collections and the local cache), instead of waking its
 * object and loading its snapshot after the tap. The web gets the same from hovering a link
 * (`web-foldkit/src/core/db/channel-prefetch.ts`); a phone has no hover.
 */
import { ClientData } from "@hazel/client-data"
import { ChannelId, type OrganizationId, type UserId } from "@hazel/schema"
import { Clock, Duration, Effect, Schedule, Stream } from "effect"
import { unreadSetOf } from "../channel-sidebar/model"
import { roleStream, unreadCountsStream, unreadStream } from "../channel-sidebar/queries"

/** At most this many channels are held: a busy workspace must not open every source it has. */
export const MAX_PREFETCHED = 8

/** Rows arrive in bursts while the org syncs; the set is taken once it has settled this long. */
const SETTLE = Duration.seconds(1)

/** How often a timed mute's end is looked at again: a channel whose mute ended counts as unread. */
const MUTE_RECHECK = Duration.minutes(1)

/**
 * The channels to hold, as one key (`Stream.changes` compares it): those with unread notifications
 * first, then the unread ones, each group in a stable order, at most `MAX_PREFETCHED`.
 */
export const prefetchKey = (notified: ReadonlyArray<ChannelId>, unread: ReadonlyArray<ChannelId>): string =>
	[...new Set([...[...notified].sort(), ...[...unread].sort()])].slice(0, MAX_PREFETCHED).join(",")

/** The channels a key names. */
const channelsOf = (key: string): ReadonlyArray<ChannelId> =>
	key === "" ? [] : key.split(",").map((id) => ChannelId.make(id))

/** Channels with unread notifications for the user's membership in the org. */
const notifiedChannels = (
	organizationId: OrganizationId,
	userId: UserId,
): Stream.Stream<ReadonlyArray<ChannelId>, never, ClientData> =>
	roleStream(organizationId, userId, (_, memberId) => memberId).pipe(
		Stream.changes,
		Stream.switchMap((memberId): Stream.Stream<ReadonlyArray<ChannelId>, never, ClientData> =>
			memberId === null
				? Stream.succeed([])
				: unreadCountsStream(memberId, (counts) =>
						Object.keys(counts).map((id) => ChannelId.make(id)),
					),
		),
	)

/** Unread channels without an active timed mute, looked at again as mutes end (`unreadSetOf`). */
const unreadChannels = (
	organizationId: OrganizationId,
	userId: UserId,
): Stream.Stream<ReadonlyArray<ChannelId>, never, ClientData> =>
	Stream.zipLatest(
		unreadStream(organizationId, userId, (rows) => rows),
		Stream.fromEffectSchedule(Clock.currentTimeMillis, Schedule.spaced(MUTE_RECHECK)),
	).pipe(
		Stream.map(([rows, nowMs]) => {
			const unread = unreadSetOf(rows, nowMs)
			return rows.flatMap((row) => (unread.has(row.channelId) ? [row.channelId] : []))
		}),
	)

/**
 * The channels from `notified` and `unread`, held through `retain` once they have settled: the set
 * is swapped (the old one let go) each time it changes.
 */
export const holdLikelyNext = <R>(
	notified: Stream.Stream<ReadonlyArray<ChannelId>, never, R>,
	unread: Stream.Stream<ReadonlyArray<ChannelId>, never, R>,
	retain: (channelIds: ReadonlyArray<ChannelId>) => Stream.Stream<never>,
	settle: Duration.Input = SETTLE,
): Stream.Stream<never, never, R> =>
	Stream.zipLatest(notified, unread).pipe(
		Stream.map(([notifiedIds, unreadIds]) => prefetchKey(notifiedIds, unreadIds)),
		// A repeated key must not restart the settle wait.
		Stream.changes,
		Stream.debounce(settle),
		Stream.changes,
		Stream.switchMap((key) => retain(channelsOf(key))),
	)

/**
 * Holds the org's likely-next channels open while it runs (muted ones are left out). A channel
 * read meanwhile is let go; the one on screen stays open through its own conversation.
 */
export const prefetchChannels = (
	organizationId: OrganizationId,
	userId: UserId,
): Stream.Stream<never, never, ClientData> =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			(data) =>
				holdLikelyNext(
					notifiedChannels(organizationId, userId),
					unreadChannels(organizationId, userId),
					(channelIds) => data.retainChannels(channelIds) as Stream.Stream<never>,
				),
		),
	)
