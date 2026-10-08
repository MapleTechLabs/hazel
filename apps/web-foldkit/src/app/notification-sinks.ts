import { ChannelId, MessageId, type NotificationId, type UserId } from "@hazel/schema"
import { Effect, Option, Schema, Stream } from "effect"
import { createIsMutedGetter } from "~/atoms/notification-sound-atoms"
import { channelCollection, messageCollection, notificationCollection, userCollection } from "~/db/collections"
import { notificationSoundManager } from "~/lib/notification-sound-manager"
import {
	inAppNotificationSink,
	NativeNotificationSink,
	type NotificationEvent,
	notificationOrchestrator,
	SoundNotificationSink,
} from "~/lib/notifications"
import type { SoundSettings } from "../notification-sound"

/**
 * The legacy `NotificationSoundProvider` (org layout) at the root: the singletons it wires (sound
 * manager, orchestrator, sound and native sinks) and the recent notifications it feeds them.
 */

/** `sessionStartTimeAtom`: notifications from before this load never play. */
const sessionStartTime = new Date()
const soundSink = new SoundNotificationSink({ notificationSoundManager })
const nativeSink = new NativeNotificationSink()

export interface SinkContext {
	readonly userId: UserId
	readonly settings: SoundSettings
	readonly currentChannelId: ChannelId | null
}

/**
 * The provider's mount effect, re-run whenever its inputs change: audio priming plus the config and
 * context getters. Do not disturb and quiet hours are read from the synced user row at decision time.
 */
export const wireNotificationSinks = ({ userId, settings, currentChannelId }: SinkContext): Stream.Stream<never> =>
	Stream.callback<never>(() =>
		Effect.acquireRelease(
			Effect.sync(() => {
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
						return {
							currentChannelId,
							sessionStartTime,
							isMuted: createIsMutedGetter(
								settings,
								userSettings?.doNotDisturb ?? false,
								userSettings?.quietHoursStart ?? "22:00",
								userSettings?.quietHoursEnd ?? "08:00",
							)(),
							isWindowFocused: document.hasFocus(),
							visibilityState: document.visibilityState,
							now: Date.now(),
						}
					},
					inAppSink: inAppNotificationSink,
					soundSink,
					nativeSink,
				})
				return cleanupPriming
			}),
			(cleanupPriming) => Effect.sync(cleanupPriming),
		).pipe(Effect.flatMap(() => Effect.never)),
	)

const decodeMessageId = Schema.decodeUnknownOption(MessageId)
const decodeChannelId = Schema.decodeUnknownOption(ChannelId)

/** The provider's `recentNotifications` effect: oldest first, with the rows the sinks describe. */
export const deliverNotifications = (ids: ReadonlyArray<NotificationId>) =>
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
			return [{ id: notification.id, notification, message, author, channel, receivedAt: Date.now() }]
		})
		notificationOrchestrator.enqueue([...events].reverse())
	})
