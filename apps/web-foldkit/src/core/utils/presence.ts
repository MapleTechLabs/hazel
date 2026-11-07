export type PresenceStatus = "online" | "away" | "busy" | "dnd" | "offline"

export type PresenceLike = {
	status?: string | null | undefined
} | null

/**
 * The status to show for a presence row: the stored one, which the user's `UserObject` keeps
 * current (offline once their heartbeat goes stale, `worker/objects/user/presence.ts`).
 *
 * `lastSeenAt` is not consulted: heartbeats refresh it only in the user's own object, so the copy
 * an org streams is as old as the last status change and says nothing about whether they are here.
 *
 * - Missing presence row => offline
 * - Otherwise the stored status (online/away/busy/dnd/offline); anything unknown => offline
 */
export function getEffectivePresenceStatus(presence: PresenceLike | undefined): PresenceStatus {
	switch (presence?.status) {
		case "online":
		case "away":
		case "busy":
		case "dnd":
			return presence.status
		default:
			return "offline"
	}
}
