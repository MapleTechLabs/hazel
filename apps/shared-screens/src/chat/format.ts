/**
 * The message list's labels, as today's chat writes them (`web-foldkit/src/chat/message/parts.ts`,
 * `core/lib/format-distance.ts`): the row clock, the date divider and the thread card's age.
 */

const pad = (value: number) => String(value).padStart(2, "0")

/** "14:02": the row's clock. */
export const formatTime = (ms: number) => {
	const date = new Date(ms)
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** "Thu Nov 05 2026": the date divider (today's `toDateString`). */
export const dateLabel = (ms: number) => new Date(ms).toDateString()

/** "14:02", or "Mon, Mar 9 14:02" before today: the new-messages bar's since. */
export const sinceLabel = (sinceMs: number, nowMs: number) => {
	const since = new Date(sinceMs)
	const time = formatTime(sinceMs)
	return since.toDateString() === new Date(nowMs).toDateString()
		? time
		: `${since.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${time}`
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`

/** date-fns' `formatDistanceStrict` with a suffix ("21 days ago"), as the thread card shows it. */
export const distanceStrict = (thenMs: number, nowMs: number) => {
	const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000))
	const minutes = Math.round(seconds / 60)
	const words =
		seconds < 60
			? plural(seconds, "second")
			: minutes < 60
				? plural(minutes, "minute")
				: minutes < 1440
					? plural(Math.round(minutes / 60), "hour")
					: minutes < 43200
						? plural(Math.round(minutes / 1440), "day")
						: minutes < 525600
							? plural(Math.round(minutes / 43200), "month")
							: plural(Math.round(minutes / 525600), "year")
	return `${words} ago`
}

/** "AL" for "Ada Lovelace": what an avatar without a picture shows. */
export const initialsOf = (name: string) => {
	const words = name.trim().split(/\s+/).filter(Boolean)
	const first = words[0]?.[0] ?? ""
	const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : ""
	return (first + last).toUpperCase() || "?"
}

/** "2.4 MB": an attachment's size. */
export const formatBytes = (bytes: number) => {
	if (bytes < 1024) return `${bytes} B`
	const units = ["KB", "MB", "GB"]
	let value = bytes / 1024
	let unit = 0
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024
		unit++
	}
	return `${value.toFixed(1)} ${units[unit]}`
}
