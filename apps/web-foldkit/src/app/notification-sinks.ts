import { ChannelId, MessageId, type NotificationId, type UserId } from "@hazel/schema"
import { Clock, Context, Duration, Effect, Layer, Option, Schema, Stream } from "effect"
import {
	channelCollection,
	messageCollection,
	notificationCollection,
	userCollection,
} from "~/db/collections"
import { notificationSoundManager } from "~/lib/notification-sound-manager"
import {
	NativeNotificationSink,
	type NotificationEvent,
	notificationOrchestrator,
	SoundNotificationSink,
} from "~/lib/notifications"
import { isSoundMuted, type SoundSettings } from "../notification-sound"

/**
 * The legacy `NotificationSoundProvider` (org layout) at the root: the sinks it wires into the
 * orchestrator, and the recent notifications it feeds them.
 */

/** The sound and native sinks, made once for the app and handed to the orchestrator while wired. */
export class NotificationSinks extends Context.Service<NotificationSinks>()("NotificationSinks", {
	make: Effect.sync(() => ({
		soundSink: new SoundNotificationSink({ notificationSoundManager }),
		nativeSink: new NativeNotificationSink(),
	})),
}) {
	static readonly layer = Layer.effect(this, this.make)
}

export interface SinkContext {
	readonly userId: UserId
	readonly settings: SoundSettings
	readonly currentChannelId: ChannelId | null
	/** Notifications from before this load never play. */
	readonly sessionStartMs: number
}

/**
 * The provider's mount effect, re-run whenever its inputs change: audio priming plus the config and
 * context getters. Do not disturb and quiet hours are read from the synced user row at decision time.
 */
export const wireNotificationSinks = ({
	userId,
	settings,
	currentChannelId,
	sessionStartMs,
}: SinkContext): Stream.Stream<never, never, NotificationSinks> =>
	Stream.callback<never, never, NotificationSinks>(() =>
		Effect.acquireRelease(
			NotificationSinks.use(({ soundSink, nativeSink }) =>
				Effect.sync(() => {
					const sessionStartTime = new Date(sessionStartMs)
					const cleanupPriming = notificationSoundManager.initPriming()
					notificationSoundManager.setDependencies({
						getConfig: () => ({
							soundFile: settings.soundFile,
							volume: settings.volume,
							cooldownMs: settings.cooldownMs,
						}),
					})
					notificationOrchestrator.setDependencies({
						getContext: () => {
							const userSettings = userCollection.state.get(userId)?.settings
							const now = Date.now()
							return {
								currentChannelId,
								sessionStartTime,
								isMuted: isSoundMuted({
									settings,
									doNotDisturb: userSettings?.doNotDisturb ?? false,
									quietHoursStart: userSettings?.quietHoursStart ?? "22:00",
									quietHoursEnd: userSettings?.quietHoursEnd ?? "08:00",
									nowMs: now,
								}),
								isWindowFocused: document.hasFocus(),
								visibilityState: document.visibilityState,
								now,
							}
						},
						soundSink,
						nativeSink,
					})
					return cleanupPriming
				}),
			),
			(cleanupPriming) => Effect.sync(cleanupPriming),
		).pipe(Effect.flatMap(() => Effect.never)),
	)

const decodeMessageId = Schema.decodeUnknownOption(MessageId)
const decodeChannelId = Schema.decodeUnknownOption(ChannelId)

/** How long a new notification waits for its channel's messages before it is described without them. */
const CHANNEL_LOAD_TIMEOUT = Duration.seconds(3)

/**
 * Opens the notifications' channels (messages sync per channel) until their snapshots are in, or
 * the timeout passes; a refused channel just leaves its message undescribed.
 */
const loadNotificationChannels = (ids: ReadonlyArray<NotificationId>) => {
	const channelIds = new Set<ChannelId>()
	for (const id of ids) {
		const notification = notificationCollection.state.get(id)
		if (notification?.targetedResourceType !== "channel") continue
		Option.map(decodeChannelId(notification.targetedResourceId), (channelId) => channelIds.add(channelId))
	}
	return messageCollection.utils.ensureChannels(channelIds).pipe(
		Effect.timeoutOption(CHANNEL_LOAD_TIMEOUT),
		Effect.asVoid,
		Effect.catchTags({
			SyncSourceForbiddenError: () => Effect.void,
			SyncSourceNotFoundError: () => Effect.void,
		}),
	)
}

/** The provider's `recentNotifications` effect: oldest first, with the rows the sinks describe. */
export const deliverNotifications = (ids: ReadonlyArray<NotificationId>) =>
	Effect.scoped(
		loadNotificationChannels(ids).pipe(
			Effect.andThen(Clock.currentTimeMillis),
			Effect.flatMap(describe(ids)),
		),
	)

const describe = (ids: ReadonlyArray<NotificationId>) => (receivedAtMs: number) =>
	Effect.sync(() => {
		const events = ids.flatMap((id): ReadonlyArray<NotificationEvent> => {
			const notification = notificationCollection.state.get(id)
			if (notification === undefined) return []
			const message = Option.getOrUndefined(
				Option.flatMapNullishOr(decodeMessageId(notification.resourceId), (id) =>
					messageCollection.state.get(id),
				),
			)
			const author = message?.authorId ? userCollection.state.get(message.authorId) : undefined
			const channel = Option.getOrUndefined(
				Option.flatMapNullishOr(decodeChannelId(notification.targetedResourceId), (id) =>
					channelCollection.state.get(id),
				),
			)
			return [{ id: notification.id, notification, message, author, channel, receivedAt: receivedAtMs }]
		})
		notificationOrchestrator.enqueue([...events].reverse())
	})
