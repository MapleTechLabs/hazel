/**
 * Timezone utilities for formatting and displaying user timezones
 */

export interface TimezoneOption {
	id: string
	label: string
	offset: string
}

/**
 * Get all available IANA timezones with formatted labels
 */
export function getTimezones(): TimezoneOption[] {
	const timezones = Intl.supportedValuesOf("timeZone")
	return timezones.map((tz) => {
		const now = new Date()
		const formatter = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			timeZoneName: "shortOffset",
		})
		const parts = formatter.formatToParts(now)
		const offset = parts.find((p) => p.type === "timeZoneName")?.value || ""

		// Format: "America/New_York" -> "New York"
		const cityName = tz.split("/").pop()?.replace(/_/g, " ") || tz

		return {
			id: tz,
			label: `${cityName} (${offset})`,
			offset,
		}
	})
}

/**
 * Formats a user's local time based on their timezone
 * @returns "3:45 PM"
 */
export function formatUserLocalTime(timezone: string | null | undefined): string {
	if (!timezone) return ""

	try {
		const now = new Date()
		const formatter = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		})

		return formatter.format(now)
	} catch {
		return ""
	}
}

/**
 * Gets the timezone abbreviation (e.g., "PST", "EST", "GMT-5")
 */
export function getTimezoneAbbreviation(timezone: string | null | undefined): string {
	if (!timezone) return ""

	try {
		const formatter = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			timeZoneName: "short",
		})
		const parts = formatter.formatToParts(new Date())
		return parts.find((p) => p.type === "timeZoneName")?.value || ""
	} catch {
		return ""
	}
}

/**
 * Detect the user's browser timezone
 */
export function detectBrowserTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export interface TimezoneCity {
	name: string
	timezone: string
	offset: number
	country: string
}

/**
 * Pre-computed list of all IANA timezones for fast searching
 * Offset is set to 0 as placeholder - calculate on demand when displaying
 */
const ALL_TIMEZONES_CACHED: TimezoneCity[] = Intl.supportedValuesOf("timeZone").map((tz) => {
	const parts = tz.split("/")
	const cityPart = parts[parts.length - 1] || tz
	return {
		name: cityPart.replace(/_/g, " "),
		timezone: tz,
		offset: 0, // Placeholder - use getTimezoneOffsetNumber() when displaying
		country: parts[0]?.replace(/_/g, " ") || "",
	}
})

/**
 * Get all IANA timezones as city objects for display (cached, fast)
 * Note: offset values are placeholders - use getTimezoneOffsetNumber() for actual offset
 */
export function getAllTimezoneCities(): TimezoneCity[] {
	return ALL_TIMEZONES_CACHED
}

/** The UTC offset of `timezone` at `at`, in minutes (east positive); null for an unknown zone. */
const utcOffsetMinutes = (timezone: string, at: Date): number | null => {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			hourCycle: "h23",
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
		}).formatToParts(at)
		const part = (type: Intl.DateTimeFormatPartTypes) =>
			Number(parts.find((each) => each.type === type)?.value ?? Number.NaN)
		const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"))
		const minute = Math.floor(at.getTime() / 60_000) * 60_000
		const offset = Math.round((wall - minute) / 60_000)
		return Number.isFinite(offset) ? offset : null
	} catch {
		return null
	}
}

/**
 * How far `timezone`'s clock is from the viewer's: "3h ahead", "1h 30m behind", or "" when they
 * match (or either is unknown).
 */
export function formatTimezoneDelta(timezone: string | null | undefined, at: Date = new Date()): string {
	if (!timezone) return ""
	const theirs = utcOffsetMinutes(timezone, at)
	if (theirs === null) return ""
	const delta = theirs + at.getTimezoneOffset()
	if (delta === 0) return ""
	const total = Math.abs(delta)
	const hours = Math.floor(total / 60)
	const minutes = total % 60
	const amount = [hours > 0 ? `${hours}h` : "", minutes > 0 ? `${minutes}m` : ""].filter(Boolean).join(" ")
	return `${amount} ${delta > 0 ? "ahead" : "behind"}`
}
