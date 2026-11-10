export type PresenceStatus = "online" | "away" | "busy" | "dnd" | "offline"

/**
 * Returns solid background class for status dot indicators
 */
export function getStatusDotColor(status?: PresenceStatus | string): string {
	switch (status) {
		case "online":
			return "bg-success"
		case "away":
		case "busy":
			return "bg-warning"
		case "dnd":
			return "bg-danger"
		default:
			// Hollow: a filled gray dot disappears against dark avatars and backgrounds.
			return "bg-bg inset-ring-2 inset-ring-muted-fg"
	}
}

/**
 * Returns the Badge component intent for a given presence status
 */
export function getStatusBadgeIntent(
	status?: PresenceStatus | string,
): "success" | "warning" | "danger" | "secondary" {
	switch (status) {
		case "online":
			return "success"
		case "away":
		case "busy":
			return "warning"
		case "dnd":
			return "danger"
		default:
			return "secondary"
	}
}

/**
 * Returns text + opacity background classes for status badges
 * @deprecated Use `getStatusBadgeIntent` with the Badge component instead
 */
export function getStatusBadgeColor(status?: PresenceStatus | string): string {
	switch (status) {
		case "online":
			return "text-success bg-success/10"
		case "away":
		case "busy":
			return "text-warning bg-warning/10"
		case "dnd":
			return "text-danger bg-danger/10"
		default:
			return "text-muted-fg bg-muted/10"
	}
}

/**
 * Returns formatted status label string
 */
export function getStatusLabel(status?: PresenceStatus | string): string {
	if (!status) return "Offline"
	if (status === "dnd") return "Do Not Disturb"
	return status.charAt(0).toUpperCase() + status.slice(1)
}

/**
 * Formats the status expiration time in a human-readable way
 */
export function formatStatusExpiration(
	expiresAt: Date | { epochMilliseconds: number } | null | undefined,
): string | null {
	if (!expiresAt) return null

	const now = new Date()
	const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt.epochMilliseconds)

	// If already expired, return null
	if (expiry <= now) return null

	const diffMs = expiry.getTime() - now.getTime()
	const diffMins = Math.round(diffMs / (1000 * 60))
	const diffHours = Math.round(diffMs / (1000 * 60 * 60))

	// Less than 1 hour - show minutes
	if (diffMins < 60) {
		return `${diffMins} min`
	}

	// Less than 24 hours - show time today
	if (diffHours < 24) {
		const timeStr = expiry.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
		// Check if it's today
		if (expiry.toDateString() === now.toDateString()) {
			return timeStr
		}
		return `tomorrow ${timeStr}`
	}

	// Otherwise show date
	const dateStr = expiry.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
	return dateStr
}
