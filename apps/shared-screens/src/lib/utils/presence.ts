export type PresenceStatus = "online" | "away" | "busy" | "dnd" | "offline"

export type PresenceLike = {
	status?: string | null | undefined
} | null

/**
 * The status to show for a presence row: the stored one. The user's `UserObject` keeps it current
 * (offline once their heartbeat goes stale, `worker/objects/user/presence.ts`), and each org
 * expires its own copy when the user's object stops renewing it (`org/projections.ts`).
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
