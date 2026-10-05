import { Atom, AsyncResult } from "effect/reactivity"
import { useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { ChannelId, UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { DateTime, Duration, Effect } from "effect"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { isInQuietHours } from "~/atoms/notification-sound-atoms"
import { presenceNowSignal } from "~/atoms/presence-atoms"
import { userCollection, userPresenceStatusCollection } from "~/db/collections"
import { useAuth, userAtom } from "~/lib/auth"
import { HazelRpcClient } from "~/lib/services/common/rpc-atom-client"
import { runtime } from "~/lib/services/common/runtime"
import { router } from "~/main"
import { getEffectivePresenceStatus, isEffectivelyOnline } from "~/utils/presence"
import { makeQuery } from "../../../../libs/tanstack-db-atom/src"

type PresenceStatus = "online" | "away" | "busy" | "dnd" | "offline"

const AFK_TIMEOUT = Duration.minutes(15)
const HEARTBEAT_INTERVAL_MS = 15_000
const ACTIVITY_BROADCAST_THROTTLE_MS = 1_000

/**
 * Atom that tracks the last user activity timestamp
 * Updates on mousemove, keydown, scroll, click, touchstart, and visibility changes
 */
const lastActivityAtom = Atom.make((get) => {
	let lastActivityMs = Date.now()
	let lastActivity = DateTime.makeUnsafe(new Date(lastActivityMs))
	let lastBroadcastAtMs = 0

	const tabId =
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID()
			: `${Date.now()}-${Math.random()}`

	const CHANNEL_NAME = "hazel:presence-activity"
	const STORAGE_KEY = "hazel:presence-activity:last"

	let channel: BroadcastChannel | null = null

	const broadcastActivity = (at: number) => {
		// Prefer BroadcastChannel when available.
		if (channel) {
			channel.postMessage({ type: "activity", at, tabId })
			return
		}

		// Fallback to localStorage + storage event.
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ type: "activity", at, tabId, nonce: Math.random() }),
			)
		} catch {
			// ignore (storage may be disabled)
		}
	}

	const applyActivity = (at: number) => {
		if (!Number.isFinite(at) || at <= lastActivityMs) return
		lastActivityMs = at
		lastActivity = DateTime.makeUnsafe(new Date(at))
		get.setSelf(lastActivity)
	}

	const handleLocalActivity = () => {
		const at = Date.now()
		lastActivityMs = at
		lastActivity = DateTime.makeUnsafe(new Date(at))
		get.setSelf(lastActivity)

		if (at - lastBroadcastAtMs >= ACTIVITY_BROADCAST_THROTTLE_MS) {
			lastBroadcastAtMs = at
			broadcastActivity(at)
		}
	}

	const handleVisibilityChange = () => {
		if (document.visibilityState === "visible") {
			// Reset activity timestamp when user returns to the tab
			// This ensures users are marked back online when returning to the app
			handleLocalActivity()
		}
	}

	const events = ["mousemove", "keydown", "scroll", "click", "touchstart"]
	events.forEach((event) => {
		window.addEventListener(event, handleLocalActivity, { passive: true })
	})

	document.addEventListener("visibilitychange", handleVisibilityChange)

	if (typeof BroadcastChannel !== "undefined") {
		try {
			channel = new BroadcastChannel(CHANNEL_NAME)
			channel.addEventListener("message", (event) => {
				const data = (event as MessageEvent).data as unknown
				if (!data || typeof data !== "object") return
				const msg = data as { type?: unknown; at?: unknown; tabId?: unknown }
				if (msg.type !== "activity") return
				if (msg.tabId === tabId) return
				if (typeof msg.at !== "number") return
				applyActivity(msg.at)
			})
		} catch {
			channel = null
		}
	}

	const handleStorage = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEY || !event.newValue) return
		try {
			const msg = JSON.parse(event.newValue) as { type?: unknown; at?: unknown; tabId?: unknown }
			if (msg.type !== "activity") return
			if (msg.tabId === tabId) return
			if (typeof msg.at !== "number") return
			applyActivity(msg.at)
		} catch {
			// ignore
		}
	}

	window.addEventListener("storage", handleStorage)

	get.addFinalizer(() => {
		events.forEach((event) => {
			window.removeEventListener(event, handleLocalActivity)
		})
		document.removeEventListener("visibilitychange", handleVisibilityChange)
		window.removeEventListener("storage", handleStorage)
		if (channel) {
			channel.close()
		}
	})

	return lastActivity
}).pipe(Atom.keepAlive)

/**
 * Atom for manual status updates
 * Stores the user's manually set status and custom message
 */
interface ManualStatus {
	status: PresenceStatus | null
	customMessage: string | null
	previousStatus: PresenceStatus
}

const manualStatusAtom = Atom.make<ManualStatus>({
	status: null,
	customMessage: null,
	previousStatus: "online",
}).pipe(Atom.keepAlive)

/**
 * Derived atom that determines if the user is AFK.
 * Re-evaluates on activity changes and on a periodic "now" tick.
 */
const afkStateAtom = Atom.make((get) => {
	// Periodic tick so we can flip to Away even if the user never triggers another event.
	const nowMs = get(presenceNowSignal)
	const lastActivity = get(lastActivityAtom)
	const timeSinceActivityMs = nowMs - DateTime.toEpochMillis(lastActivity)
	const isAFK = timeSinceActivityMs >= Duration.toMillis(AFK_TIMEOUT)
	return { isAFK, timeSinceActivityMs }
}).pipe(Atom.keepAlive)

/**
 * Derived atom that computes the final presence status.
 * Manual status overrides AFK-derived Away/Online.
 *
 * Note: Offline is derived from `lastSeenAt` elsewhere; we don't auto-set Offline from the client.
 */
const computedPresenceStatusAtom = Atom.make((get) => {
	const manualStatus = get(manualStatusAtom)
	if (manualStatus.status !== null) return manualStatus.status

	const afkState = get(afkStateAtom)
	return afkState.isAFK ? ("away" as const) : ("online" as const)
})

/**
 * Atom that tracks the current route's channel ID
 * Only extracts channel ID when user is on a chat route (/$orgSlug/chat/$id)
 */
export const currentChannelIdAtom = Atom.make((get) => {
	let currentChannelId: string | null = null

	const unsubscribe = router.subscribe("onResolved", (event) => {
		// Only extract channel ID if we're on a chat route
		const pathname = event.toLocation.pathname
		const pathSegments = pathname.split("/")

		// Check if route matches /$orgSlug/chat/$id pattern
		const chatIndex = pathSegments.indexOf("chat")
		const isOnChatRoute = chatIndex !== -1 && chatIndex < pathSegments.length - 1

		const channelId = isOnChatRoute ? (pathSegments[chatIndex + 1] ?? null) : null

		if (channelId !== currentChannelId) {
			currentChannelId = channelId
			get.setSelf(channelId)
		}
	})

	get.addFinalizer(unsubscribe)

	// Get initial value from current route
	const pathname = router.state.location.pathname
	const pathSegments = pathname.split("/")
	const chatIndex = pathSegments.indexOf("chat")
	const isOnChatRoute = chatIndex !== -1 && chatIndex < pathSegments.length - 1
	currentChannelId = isOnChatRoute ? (pathSegments[chatIndex + 1] ?? null) : null

	return currentChannelId
}).pipe(Atom.keepAlive)

/**
 * Atom that sends periodic heartbeat pings to the server.
 * This enables reliable offline detection - if no heartbeat is received
 * within the timeout period, the server-side cron job marks the user offline.
 */
const heartbeatAtom = Atom.make((get) => {
	const user = AsyncResult.getOrElse(get(userAtom), () => null)

	// Skip if no user
	if (!user?.id) return null

	let inFlight = false

	const sendHeartbeat = () => {
		if (inFlight) return
		inFlight = true

		const program = Effect.gen(function* () {
			const client = yield* HazelRpcClient
			yield* client("userPresenceStatus.heartbeat", {})
		})

		runtime
			.runPromise(program)
			.catch((error) => {
				console.error("Heartbeat failed:", error)
			})
			.finally(() => {
				inFlight = false
			})
	}

	// Send immediately on mount.
	sendHeartbeat()

	const intervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

	get.addFinalizer(() => {
		clearInterval(intervalId)
	})

	return user.id
}).pipe(Atom.keepAlive)

/**
 * Atom family that queries the current user's presence status from TanStack DB
 * Returns Result<PresenceData[]> that automatically updates when data changes
 */
const currentUserPresenceAtomFamily = Atom.family((userId: UserId) =>
	makeQuery((q) =>
		q
			.from({ presence: userPresenceStatusCollection })
			.where(({ presence }) => eq(presence.userId, userId))
			.orderBy(({ presence }) => presence.updatedAt, "desc")
			.findOne(),
	),
)

/**
 * Atom family that queries user settings from TanStack DB
 * Used to check quiet hours configuration for other users
 */
const userSettingsAtomFamily = Atom.family((userId: UserId) =>
	makeQuery((q) =>
		q
			.from({ user: userCollection })
			.where(({ user }) => eq(user.id, userId))
			.select(({ user }) => ({
				settings: user.settings,
			}))
			.findOne(),
	),
)

/**
 * Atom that automatically queries presence for the current user
 * Reads from userAtom and returns the presence data
 */
const currentUserPresenceAtom = Atom.make((get) => {
	const user = AsyncResult.getOrElse(get(userAtom), () => null)
	if (!user?.id) return AsyncResult.initial(false)

	return get(currentUserPresenceAtomFamily(user.id))
})

/**
 * Effects-only hook for presence - mounts heartbeat and syncs status to server.
 * Does NOT subscribe to frequently-changing atoms (presenceNowSignal, afkStateAtom).
 * Use this in providers/layouts to avoid re-rendering children.
 */
export function usePresenceEffects() {
	const { user } = useAuth()

	// Only subscribe to atoms needed for the sync effect
	const computedStatus = useAtomValue(computedPresenceStatusAtom)
	const currentChannelId = useAtomValue(currentChannelIdAtom)

	// Track previous values to avoid duplicate updates
	const previousValuesRef = useRef<{
		status: PresenceStatus | null
		channelId: string | null
		initialUpdateSent: boolean
	}>({
		status: null,
		channelId: null,
		initialUpdateSent: false,
	})

	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

	// Sync effect - sends presence updates to server when status or channel changes
	useEffect(() => {
		if (!user?.id) return

		// Send ONE initial update to mark user online (websocket only handles offline)
		// But debounce it to batch with any rapid initial changes
		if (!previousValuesRef.current.initialUpdateSent) {
			previousValuesRef.current.initialUpdateSent = true

			// Debounce the initial update to batch with rapid atom initialization
			debounceTimerRef.current = setTimeout(() => {
				previousValuesRef.current.status = computedStatus
				previousValuesRef.current.channelId = currentChannelId

				const program = Effect.gen(function* () {
					const client = yield* HazelRpcClient
					yield* client("userPresenceStatus.update", {
						status: computedStatus,
						activeChannelId: currentChannelId ? (currentChannelId as ChannelId) : null,
					})
				})

				runtime.runPromise(program).catch(console.error)
			}, 300) // Debounce to batch with rapid atom updates during mount

			return
		}

		// Check if values have actually changed
		const statusChanged = previousValuesRef.current.status !== computedStatus
		const channelChanged = previousValuesRef.current.channelId !== currentChannelId

		if (!statusChanged && !channelChanged) {
			return
		}

		// Clear existing debounce timer
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current)
		}

		// Debounce updates to batch rapid changes
		debounceTimerRef.current = setTimeout(() => {
			// Update previous values
			previousValuesRef.current.status = computedStatus
			previousValuesRef.current.channelId = currentChannelId

			// Send batched update with only changed fields
			const program = Effect.gen(function* () {
				const client = yield* HazelRpcClient
				const updates: {
					status?: PresenceStatus
					activeChannelId?: ChannelId | null
				} = {}

				if (statusChanged) {
					updates.status = computedStatus
				}

				if (channelChanged) {
					updates.activeChannelId = currentChannelId ? (currentChannelId as ChannelId) : null
				}

				yield* client("userPresenceStatus.update", updates)
			})

			runtime.runPromise(program).catch(console.error)
		}, 300) // 300ms debounce

		// Cleanup debounce timer on unmount
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
		}
	}, [computedStatus, currentChannelId, user?.id])

	// Mount heartbeat
	useAtomMount(heartbeatAtom)
}

/**
 * Hook for managing the current user's presence status
 */
export function usePresence() {
	const { user } = useAuth()

	// Run all side effects (heartbeat, sync to server)
	usePresenceEffects()

	// Subscribe to atoms for return values (these cause re-renders, but that's expected for consumers)
	const nowMs = useAtomValue(presenceNowSignal)
	const presenceResult = useAtomValue(currentUserPresenceAtom)
	const currentPresence = AsyncResult.getOrElse(presenceResult, () => undefined)
	const computedStatus = useAtomValue(computedPresenceStatusAtom)
	const afkState = useAtomValue(afkStateAtom)

	// Query current user's settings for quiet hours
	const userSettingsResult = useAtomValue(userSettingsAtomFamily(user?.id as UserId))
	const userSettings = AsyncResult.getOrElse(userSettingsResult, () => undefined)

	// Compute quiet hours for current user
	const quietHours = useMemo((): QuietHoursInfo | undefined => {
		if (userSettings?.settings?.showQuietHoursInStatus === false) {
			return undefined
		}
		const start = userSettings?.settings?.quietHoursStart ?? null
		const end = userSettings?.settings?.quietHoursEnd ?? null
		if (!start || !end) return undefined
		return {
			isActive: isInQuietHours(start, end),
			start,
			end,
		}
	}, [
		userSettings?.settings?.showQuietHoursInStatus,
		userSettings?.settings?.quietHoursStart,
		userSettings?.settings?.quietHoursEnd,
	])

	const currentChannelId = useAtomValue(currentChannelIdAtom)
	const setManualStatus = useAtomSet(manualStatusAtom)

	const previousManualStatusRef = useRef<PresenceStatus>("online")

	const setStatus = useCallback(
		async (status: PresenceStatus, customMessage?: string) => {
			if (!user?.id) return undefined

			setManualStatus({
				status,
				customMessage: customMessage ?? null,
				previousStatus: previousManualStatusRef.current,
			})

			previousManualStatusRef.current = status

			const program = Effect.gen(function* () {
				const client = yield* HazelRpcClient
				return yield* client("userPresenceStatus.update", {
					status,
					customMessage: customMessage ?? null,
				})
			})

			return runtime.runPromiseExit(program)
		},
		[user?.id, setManualStatus],
	)

	const setCustomStatus = useCallback(
		async (
			emoji: string | null,
			message: string | null,
			expiresAt: Date | null,
			suppressNotifications?: boolean,
		) => {
			if (!user?.id) return undefined

			const program = Effect.gen(function* () {
				const client = yield* HazelRpcClient
				return yield* client("userPresenceStatus.update", {
					statusEmoji: emoji,
					customMessage: message,
					statusExpiresAt: expiresAt,
					suppressNotifications,
				})
			})

			return runtime.runPromiseExit(program)
		},
		[user?.id],
	)

	const clearCustomStatus = useCallback(async () => {
		if (!user?.id) return undefined

		const program = Effect.gen(function* () {
			const client = yield* HazelRpcClient
			return yield* client("userPresenceStatus.clearStatus", {})
		})

		return runtime.runPromiseExit(program)
	}, [user?.id])

	const effectiveStatus = getEffectivePresenceStatus(currentPresence ?? null, nowMs)
	const displayStatus =
		computedStatus === "online"
			? effectiveStatus === "offline"
				? ("online" as const)
				: effectiveStatus
			: computedStatus

	return {
		// Prefer local computed status for online/away transitions, but never show "offline" for the local user
		// when we have a recent heartbeat (effectiveStatus covers anti-flicker).
		status: displayStatus,
		isAFK: afkState.isAFK,
		setStatus,
		setCustomStatus,
		clearCustomStatus,
		activeChannelId: currentPresence?.activeChannelId,
		customMessage: currentPresence?.customMessage,
		statusEmoji: currentPresence?.statusEmoji,
		statusExpiresAt: currentPresence?.statusExpiresAt,
		suppressNotifications: currentPresence?.suppressNotifications ?? false,
		quietHours,
	}
}

export interface QuietHoursInfo {
	isActive: boolean
	start?: string
	end?: string
}

/**
 * Lightweight hook that only subscribes to the current user's
 * presence record from the database. Does NOT subscribe to
 * presenceNowSignal, afkStateAtom, computedPresenceStatusAtom,
 * or any other frequently-changing atoms.
 *
 * Use this when you only need statusEmoji, customMessage,
 * statusExpiresAt, or suppressNotifications.
 */
export function useCurrentUserStatus() {
	const presenceResult = useAtomValue(currentUserPresenceAtom)
	const currentPresence = AsyncResult.getOrElse(presenceResult, () => undefined)

	return {
		statusEmoji: currentPresence?.statusEmoji ?? null,
		customMessage: currentPresence?.customMessage ?? null,
		statusExpiresAt: currentPresence?.statusExpiresAt ?? null,
		suppressNotifications: currentPresence?.suppressNotifications ?? false,
	}
}

/**
 * Lightweight hook for another user's status display (emoji, message, quiet hours).
 * Does NOT subscribe to presenceNowSignal — avoids 5-second re-render cycle.
 * Use this in message headers and other places that don't need live online/offline status.
 */
export function useUserStatus(userId: UserId) {
	const presenceResult = useAtomValue(currentUserPresenceAtomFamily(userId))
	const presence = AsyncResult.getOrElse(presenceResult, () => undefined)
	const userSettingsResult = useAtomValue(userSettingsAtomFamily(userId))
	const userSettings = AsyncResult.getOrElse(userSettingsResult, () => undefined)

	const quietHours = useMemo((): QuietHoursInfo | undefined => {
		if (userSettings?.settings?.showQuietHoursInStatus === false) return undefined
		const start = userSettings?.settings?.quietHoursStart ?? null
		const end = userSettings?.settings?.quietHoursEnd ?? null
		if (!start || !end) return undefined
		return {
			isActive: isInQuietHours(start, end),
			start,
			end,
		}
	}, [
		userSettings?.settings?.showQuietHoursInStatus,
		userSettings?.settings?.quietHoursStart,
		userSettings?.settings?.quietHoursEnd,
	])

	return {
		statusEmoji: presence?.statusEmoji,
		customMessage: presence?.customMessage,
		statusExpiresAt: presence?.statusExpiresAt,
		quietHours,
	}
}

/**
 * Hook to get another user's presence
 */
export function useUserPresence(userId: UserId) {
	const nowMs = useAtomValue(presenceNowSignal)
	const presenceResult = useAtomValue(currentUserPresenceAtomFamily(userId))
	const presence = AsyncResult.getOrElse(presenceResult, () => undefined)
	const userSettingsResult = useAtomValue(userSettingsAtomFamily(userId))
	const userSettings = AsyncResult.getOrElse(userSettingsResult, () => undefined)

	// Compute quiet hours state
	const quietHours = useMemo((): QuietHoursInfo | undefined => {
		// If user has opted out of showing quiet hours in status, don't return info
		if (userSettings?.settings?.showQuietHoursInStatus === false) {
			return undefined
		}

		const quietHoursStart = userSettings?.settings?.quietHoursStart ?? null
		const quietHoursEnd = userSettings?.settings?.quietHoursEnd ?? null

		// If quiet hours are not configured, don't return info
		if (!quietHoursStart || !quietHoursEnd) {
			return undefined
		}

		return {
			isActive: isInQuietHours(quietHoursStart, quietHoursEnd),
			start: quietHoursStart,
			end: quietHoursEnd,
		}
	}, [
		userSettings?.settings?.showQuietHoursInStatus,
		userSettings?.settings?.quietHoursStart,
		userSettings?.settings?.quietHoursEnd,
	])

	const status = getEffectivePresenceStatus(presence ?? null, nowMs)

	return {
		status,
		isOnline: isEffectivelyOnline(status),
		activeChannelId: presence?.activeChannelId,
		customMessage: presence?.customMessage,
		statusEmoji: presence?.statusEmoji,
		statusExpiresAt: presence?.statusExpiresAt,
		lastUpdated: presence?.updatedAt,
		quietHours,
	}
}
