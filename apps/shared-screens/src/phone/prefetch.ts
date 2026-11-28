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
import type { OrganizationId, UserId } from "@hazel/schema"
import { Duration, Effect, Stream } from "effect"
import { roleStream, unreadCountsStream, unreadStream } from "../channel-sidebar/queries"

/** At most this many channels are held: a busy workspace must not open every source it has. */
export const MAX_PREFETCHED = 8

/** Rows arrive in bursts while the org syncs; the set is taken once it has settled this long. */
const SETTLE = Duration.seconds(1)

/**
 * The channels to hold, as one key (`Stream.changes` compares it): those with unread notifications
 * first, then the unread ones, each group in a stable order, at most `MAX_PREFETCHED`.
 */
export const prefetchKey = (notified: ReadonlyArray<string>, unread: ReadonlyArray<string>): string =>
	[...new Set([...[...notified].sort(), ...[...unread].sort()])].slice(0, MAX_PREFETCHED).join(",")

/** Channels with unread notifications for the user's membership in the org. */
const notifiedChannels = (
	organizationId: OrganizationId,
	userId: UserId,
): Stream.Stream<ReadonlyArray<string>, never, ClientData> =>
	roleStream(organizationId, userId, (_, memberId) => memberId).pipe(
		Stream.changes,
		Stream.switchMap((memberId): Stream.Stream<ReadonlyArray<string>, never, ClientData> =>
			memberId === null
				? Stream.succeed([])
				: unreadCountsStream(memberId, (counts): ReadonlyArray<string> => Object.keys(counts)),
		),
	)

/**
 * The channels from `notified` and `unread`, held through `retain` once they have settled: the set
 * is swapped (the old one let go) each time it changes.
 */
export const holdLikelyNext = <R>(
	notified: Stream.Stream<ReadonlyArray<string>, never, R>,
	unread: Stream.Stream<ReadonlyArray<string>, never, R>,
	retain: (channelIds: ReadonlyArray<string>) => Stream.Stream<never>,
	settle: Duration.Input = SETTLE,
): Stream.Stream<never, never, R> =>
	Stream.zipLatest(notified, unread).pipe(
		Stream.map(([notifiedIds, unreadIds]) => prefetchKey(notifiedIds, unreadIds)),
		Stream.debounce(settle),
		Stream.changes,
		Stream.switchMap((key) => retain(key === "" ? [] : key.split(","))),
	)

/**
 * Holds the org's likely-next channels open while it runs (muted ones are never unread). A channel
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
					unreadStream(organizationId, userId, (rows) => rows.map((row): string => row.channelId)),
					(channelIds) => data.retainChannels(channelIds) as Stream.Stream<never>,
				),
		),
	)
