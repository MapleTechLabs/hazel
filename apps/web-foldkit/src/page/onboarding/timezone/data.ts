import { Option } from "effect"
import { getAllTimezoneCities, type TimezoneCity } from "~/utils/timezone"

/** The timezone step's data: curated cities (from `timezone-selection-step.tsx`) and the search. */

export const CITIES: ReadonlyArray<TimezoneCity> = [
	// Americas & Pacific
	{ name: "Pago Pago", timezone: "Pacific/Pago_Pago", offset: -11, country: "American Samoa" },
	{ name: "Honolulu", timezone: "Pacific/Honolulu", offset: -10, country: "USA" },
	{ name: "Anchorage", timezone: "America/Anchorage", offset: -9, country: "USA" },
	{ name: "Los Angeles", timezone: "America/Los_Angeles", offset: -8, country: "USA" },
	{ name: "Denver", timezone: "America/Denver", offset: -7, country: "USA" },
	{ name: "Chicago", timezone: "America/Chicago", offset: -6, country: "USA" },
	{ name: "New York", timezone: "America/New_York", offset: -5, country: "USA" },
	{ name: "Santiago", timezone: "America/Santiago", offset: -4, country: "Chile" },
	{ name: "São Paulo", timezone: "America/Sao_Paulo", offset: -3, country: "Brazil" },
	{ name: "Buenos Aires", timezone: "America/Argentina/Buenos_Aires", offset: -3, country: "Argentina" },
	{ name: "Toronto", timezone: "America/Toronto", offset: -5, country: "Canada" },
	{ name: "Mexico City", timezone: "America/Mexico_City", offset: -6, country: "Mexico" },
	// Europe & Atlantic
	{ name: "Azores", timezone: "Atlantic/Azores", offset: -1, country: "Portugal" },
	{ name: "London", timezone: "Europe/London", offset: 0, country: "UK" },
	{ name: "Paris", timezone: "Europe/Paris", offset: 1, country: "France" },
	{ name: "Berlin", timezone: "Europe/Berlin", offset: 1, country: "Germany" },
	{ name: "Amsterdam", timezone: "Europe/Amsterdam", offset: 1, country: "Netherlands" },
	{ name: "Moscow", timezone: "Europe/Moscow", offset: 3, country: "Russia" },
	{ name: "Istanbul", timezone: "Europe/Istanbul", offset: 3, country: "Turkey" },
	// Africa & Middle East
	{ name: "Cairo", timezone: "Africa/Cairo", offset: 2, country: "Egypt" },
	{ name: "Dubai", timezone: "Asia/Dubai", offset: 4, country: "UAE" },
	{ name: "Lagos", timezone: "Africa/Lagos", offset: 1, country: "Nigeria" },
	{ name: "Johannesburg", timezone: "Africa/Johannesburg", offset: 2, country: "South Africa" },
	// Asia
	{ name: "Karachi", timezone: "Asia/Karachi", offset: 5, country: "Pakistan" },
	{ name: "Mumbai", timezone: "Asia/Kolkata", offset: 5.5, country: "India" },
	{ name: "Dhaka", timezone: "Asia/Dhaka", offset: 6, country: "Bangladesh" },
	{ name: "Bangkok", timezone: "Asia/Bangkok", offset: 7, country: "Thailand" },
	{ name: "Singapore", timezone: "Asia/Singapore", offset: 8, country: "Singapore" },
	{ name: "Hong Kong", timezone: "Asia/Hong_Kong", offset: 8, country: "China" },
	{ name: "Tokyo", timezone: "Asia/Tokyo", offset: 9, country: "Japan" },
	{ name: "Seoul", timezone: "Asia/Seoul", offset: 9, country: "South Korea" },
	// Oceania & Pacific
	{ name: "Brisbane", timezone: "Australia/Brisbane", offset: 10, country: "Australia" },
	{ name: "Sydney", timezone: "Australia/Sydney", offset: 11, country: "Australia" },
	{ name: "Fiji", timezone: "Pacific/Fiji", offset: 12, country: "Fiji" },
	{ name: "Auckland", timezone: "Pacific/Auckland", offset: 12, country: "New Zealand" },
]

const hourMinuteAt = Option.liftThrowable((timezone: string, nowMs: number) =>
	new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hour: "numeric",
		minute: "numeric",
		hourCycle: "h23",
	}).formatToParts(new Date(nowMs)),
)

/** `getTimezoneOffsetNumber` at `nowMs` instead of the wall clock, so the view stays pure. */
export const offsetAt = (timezone: string, nowMs: number): number =>
	Option.match(hourMinuteAt(timezone, nowMs), {
		onNone: () => 0,
		onSome: (parts) => {
			const now = new Date(nowMs)
			const part = (type: string) => Number.parseInt(parts.find((p) => p.type === type)?.value || "0")
			const hourDiff = part("hour") - now.getUTCHours()
			const wrapped = hourDiff > 12 ? hourDiff - 24 : hourDiff < -12 ? hourDiff + 24 : hourDiff
			return wrapped + (part("minute") - now.getUTCMinutes()) / 60
		},
	})

/** `timezoneToCity` with the offset at `nowMs`. */
const zoneToCity = (timezone: string, nowMs: number): TimezoneCity => {
	const parts = timezone.split("/")
	return {
		name: (parts[parts.length - 1] || timezone).replace(/_/g, " "),
		timezone,
		offset: offsetAt(timezone, nowMs),
		country: parts[0]?.replace(/_/g, " ") || "",
	}
}

export const cityFor = (timezone: string, nowMs: number): TimezoneCity =>
	CITIES.find((city) => city.timezone === timezone) ?? zoneToCity(timezone, nowMs)

/** `filteredCities`: curated cities (detected one first) or up to 30 matches across every zone. */
export const filterCities = (
	query: string,
	detectedTimezone: string,
	nowMs: number,
): ReadonlyArray<TimezoneCity> => {
	const normalized = query.toLowerCase().trim()
	if (!normalized) {
		const detected = cityFor(detectedTimezone, nowMs)
		return CITIES.some((city) => city.timezone === detected.timezone) ? CITIES : [detected, ...CITIES]
	}
	return getAllTimezoneCities()
		.filter(
			(city) =>
				city.name.toLowerCase().includes(normalized) ||
				city.country.toLowerCase().includes(normalized) ||
				city.timezone.toLowerCase().includes(normalized),
		)
		.sort((a, b) => {
			if (a.timezone === detectedTimezone) return -1
			if (b.timezone === detectedTimezone) return 1
			return a.name.localeCompare(b.name)
		})
		.slice(0, 30)
		.map((city) => ({ ...city, offset: offsetAt(city.timezone, nowMs) }))
}
