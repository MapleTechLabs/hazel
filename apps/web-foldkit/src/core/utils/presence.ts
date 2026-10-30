import type { DateTime } from "effect"

export type PresenceStatus = "online" | "away" | "busy" | "dnd" | "offline"

export const DEFAULT_OFFLINE_THRESHOLD_MS = 45_000

export type PresenceLike = {
	status?: string | null | undefined
	lastSeenAt?: Date | DateTime.Utc | null | undefined
} | null

/**
 * Derive an "effective" presence status from the stored status + lastSeenAt.
 *
 * Rules:
 * - Missing presence row => offline
 * - Stale lastSeenAt => offline
 * - Recent lastSeenAt but stored status is "offline" => treat as "online" (anti-flicker while status replicates)
 * - Otherwise use stored status (online/away/busy/dnd)
 */
export function getEffectivePresenceStatus(
	presence: PresenceLike | undefined,
	nowMs: number,
	offlineThresholdMs: number = DEFAULT_OFFLINE_THRESHOLD_MS,
): PresenceStatus {
	if (!presence) return "offline"

	const lastSeenAt = presence.lastSeenAt
	if (!lastSeenAt) {
		return "offline"
	}

	const lastSeenMs = lastSeenAt instanceof Date ? lastSeenAt.getTime() : lastSeenAt.epochMilliseconds
	if (Number.isNaN(lastSeenMs)) {
		return "offline"
	}

	if (nowMs - lastSeenMs > offlineThresholdMs) {
		return "offline"
	}

	if (presence.status === "offline") {
		return "online"
	}

	switch (presence.status) {
		case "online":
		case "away":
		case "busy":
		case "dnd":
			return presence.status
		default:
			return "offline"
	}
}
