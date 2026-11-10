import type { DateTime } from "effect"
import { toEpochMs } from "~/lib/utils"

/**
 * Display formatting for the Customers area: money (integer minor units), counts, percents, deltas,
 * relative ages and dates. Pure: anything time-relative takes `now`, anything zoned takes `timeZone`
 * (default: the browser's), so views and tests agree.
 */

/** What the synced rows carry for an instant (`JsonDate`). */
export type Instant = Date | DateTime.Utc

/** U+2212, so a negative number lines up with a positive one in tabular figures. */
const MINUS = "−"

const DAY_MS = 86_400_000

const fractionDigitsOf = (currency: string): number =>
	new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ??
	2

/** Minor units → major units, using the currency's own exponent (JPY has none). */
export const toMajor = (minor: number, currency = "USD"): number => minor / 10 ** fractionDigitsOf(currency)

const withSign = (value: number, text: string, signed: boolean): string =>
	value < 0 ? `${MINUS}${text}` : signed && value > 0 ? `+${text}` : text

const currencyFormat = (currency: string, options: Intl.NumberFormatOptions) =>
	new Intl.NumberFormat("en-US", { style: "currency", currency, ...options })

/** `$48,210`; `cents` keeps the minor units (`$1,240.00`); `signed` adds `+` to a gain. */
export const formatMoney = (
	minor: number,
	currency = "USD",
	options: Readonly<{ cents?: boolean; signed?: boolean }> = {},
): string => {
	const digits = options.cents ? fractionDigitsOf(currency) : 0
	const text = currencyFormat(currency, {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	}).format(Math.abs(toMajor(minor, currency)))
	return withSign(Math.round(minor), text, options.signed ?? false)
}

/** `$940`, `$48.2K`, `$1.2M`: KPI subtitles, axis ticks, tight cells. */
export const formatMoneyCompact = (
	minor: number,
	currency = "USD",
	options: Readonly<{ signed?: boolean }> = {},
): string => {
	const text = currencyFormat(currency, {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(Math.abs(toMajor(minor, currency)))
	return withSign(minor, text, options.signed ?? false)
}

/** `1,611`. */
export const formatCount = (value: number): string =>
	new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)

/** `461K`, `1.2M`, `980`. */
export const formatCompact = (value: number): string =>
	withSign(
		value,
		new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
			Math.abs(value),
		),
		false,
	)

/** One decimal under 10, none above: `6.2`, `42`, `0`. */
const percentNumber = (value: number, digits?: number): string => {
	const abs = Math.abs(value)
	const fraction = digits ?? (abs !== 0 && abs < 10 ? 1 : 0)
	return new Intl.NumberFormat("en-US", {
		minimumFractionDigits: 0,
		maximumFractionDigits: fraction,
	}).format(abs)
}

/** A percent given as a percent number (`61` → `61%`, `2.8` → `2.8%`). */
export const formatPct = (value: number, options: Readonly<{ digits?: number }> = {}): string =>
	withSign(value, `${percentNumber(value, options.digits)}%`, false)

/** A change in percent: `+6.2%`, `−38%`, `0%`. */
export const formatDeltaPct = (value: number, options: Readonly<{ digits?: number }> = {}): string =>
	withSign(value, `${percentNumber(value, options.digits)}%`, true)

/** A change in percentage points (or score points): `+0.9 pt`, `−20 pts`. */
export const formatDeltaPoints = (value: number, unit: "pt" | "pts" = "pt"): string =>
	withSign(value, `${percentNumber(value)} ${unit}`, true)

/** Signed count: `+12`, `−3`. */
export const formatDeltaCount = (value: number): string => withSign(value, formatCount(Math.abs(value)), true)

/** Whether a change reads as good, bad or neither, given which direction is good for the metric. */
export type DeltaTone = "positive" | "negative" | "neutral"

export const deltaTone = (delta: number | null, goodWhen: "up" | "down" = "up"): DeltaTone =>
	delta === null || delta === 0 ? "neutral" : delta > 0 === (goodWhen === "up") ? "positive" : "negative"

/** Whole days between two instants, floored (`now - at`). */
export const daysBetween = (at: Instant, now: Instant): number =>
	Math.floor((toEpochMs(now) - toEpochMs(at)) / DAY_MS)

/** `just now`, `5m ago`, `2h ago`, `18d ago`, `3mo ago`, `2y ago`; a future instant reads `in 4d`. */
export const formatRelative = (at: Instant, now: Instant): string => {
	const deltaMs = toEpochMs(now) - toEpochMs(at)
	const future = deltaMs < 0
	const minutes = Math.floor(Math.abs(deltaMs) / 60_000)
	const text =
		minutes < 1
			? null
			: minutes < 60
				? `${minutes}m`
				: minutes < 60 * 24
					? `${Math.floor(minutes / 60)}h`
					: minutes < 60 * 24 * 60
						? `${Math.floor(minutes / (60 * 24))}d`
						: minutes < 60 * 24 * 365
							? `${Math.floor(minutes / (60 * 24 * 30))}mo`
							: `${Math.floor(minutes / (60 * 24 * 365))}y`
	return text === null ? "just now" : future ? `in ${text}` : `${text} ago`
}

/** `1 day`, `4 days`. */
export const formatDays = (days: number): string =>
	`${formatCount(days)} ${Math.abs(days) === 1 ? "day" : "days"}`

/** `4 days left`, `1 day left`, `Ends today`, `Ended 2 days ago`. */
export const formatDaysLeft = (days: number): string =>
	days > 0 ? `${formatDays(days)} left` : days === 0 ? "Ends today" : `Ended ${formatDays(-days)} ago`

const dateFormat = (options: Intl.DateTimeFormatOptions, timeZone: string | undefined) =>
	new Intl.DateTimeFormat("en-US", { ...options, timeZone })

const yearOf = (ms: number, timeZone: string | undefined) =>
	Number(dateFormat({ year: "numeric" }, timeZone).format(ms))

/** `Nov 9`, or `Nov 9, 2025` outside `now`'s year. */
export const formatDate = (
	at: Instant,
	options: Readonly<{ now?: Instant; timeZone?: string; withYear?: boolean }> = {},
): string => {
	const ms = toEpochMs(at)
	const withYear =
		options.withYear ??
		(options.now !== undefined &&
			yearOf(ms, options.timeZone) !== yearOf(toEpochMs(options.now), options.timeZone))
	return dateFormat(
		{ month: "short", day: "numeric", year: withYear ? "numeric" : undefined },
		options.timeZone,
	).format(ms)
}

/** `Nov 9, 18:42`. */
export const formatDateTime = (at: Instant, options: Readonly<{ timeZone?: string }> = {}): string =>
	dateFormat(
		{ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
		options.timeZone,
	).format(toEpochMs(at))

/** `Wed, 9:00 AM`: snooze targets. */
export const formatWeekdayTime = (at: Instant, options: Readonly<{ timeZone?: string }> = {}): string =>
	dateFormat({ weekday: "short", hour: "numeric", minute: "2-digit" }, options.timeZone).format(
		toEpochMs(at),
	)

/** A UTC `Day` (`YYYY-MM-DD`) as epoch ms at its midnight. */
export const dayToMs = (day: string): number => Date.parse(`${day}T00:00:00Z`)

/** Day labels are UTC: a `Day` names a UTC calendar day. */
const dayFormat = (options: Intl.DateTimeFormatOptions) =>
	new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" })

/** `Nov 2` (axis ticks). */
export const formatDay = (day: string): string =>
	dayFormat({ month: "short", day: "numeric" }).format(dayToMs(day))

/** `Sun, Nov 2` (tooltip headings). */
export const formatDayLong = (day: string): string =>
	dayFormat({ weekday: "short", month: "short", day: "numeric" }).format(dayToMs(day))

/** `Oct` (monthly axis ticks). */
export const formatMonthShort = (day: string): string => dayFormat({ month: "short" }).format(dayToMs(day))

/** `October 2026` (monthly tooltip headings). */
export const formatMonthLong = (day: string): string =>
	dayFormat({ month: "long", year: "numeric" }).format(dayToMs(day))

/** `Week of Nov 2` (weekly tooltip headings). */
export const formatWeekOf = (day: string): string => `Week of ${formatDay(day)}`

/** A chart bucket's heading and axis label. */
export const bucketLabels = (
	bucket: "day" | "week" | "month",
	day: string,
): Readonly<{ tick: string; heading: string }> =>
	bucket === "month"
		? { tick: formatMonthShort(day), heading: formatMonthLong(day) }
		: bucket === "week"
			? { tick: formatDay(day), heading: formatWeekOf(day) }
			: { tick: formatDay(day), heading: formatDayLong(day) }
