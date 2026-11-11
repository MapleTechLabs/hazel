import { formatDistance } from "date-fns"

/**
 * "3 days ago" or "in about 2 hours": date-fns `formatDistanceToNow` with the suffix, measured against
 * the Model's clock (`nowMs`) so the text only changes when a view is redrawn with a new time.
 */
export const formatDistanceToNow = (date: Date | number, nowMs: number): string =>
	formatDistance(date, nowMs, { addSuffix: true })
