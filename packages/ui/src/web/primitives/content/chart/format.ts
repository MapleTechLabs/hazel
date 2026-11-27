/**
 * How a chart prints its values (`ChartFormat`), as today's customers pages do (`customers/format.ts`,
 * `customers/sla.ts`): `value` for the tooltip and end labels, `axis` for the compact y ticks.
 * Units: `currency` values are integer minor units in the chart's `currency`, `percent` values are
 * percent numbers (61 is 61%), `duration` values are milliseconds.
 */
import type { ChartFormat } from "../../../../vocabulary/options.ts"

/** U+2212, so a negative number lines up with a positive one in tabular figures. */
const MINUS = "−"
const MINUTE = 60_000
const HOUR = 3_600_000

const intlCache = new Map<string, Intl.NumberFormat>()
const numberFormat = (options: Intl.NumberFormatOptions): Intl.NumberFormat => {
	const key = JSON.stringify(options)
	const existing = intlCache.get(key)
	if (existing !== undefined) return existing
	const made = new Intl.NumberFormat("en-US", options)
	intlCache.set(key, made)
	return made
}

/** Whether `Intl` knows the code; one it does not is shown as a plain number and the code. */
const isKnownCurrency = (currency: string): boolean => {
	try {
		numberFormat({ style: "currency", currency })
		return true
	} catch {
		return false
	}
}

const fractionDigitsOf = (currency: string): number =>
	isKnownCurrency(currency)
		? (numberFormat({ style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2)
		: 2

const withSign = (value: number, text: string, signed: boolean): string =>
	value < 0 ? `${MINUS}${text}` : signed && value > 0 ? `+${text}` : text

const roundTo = (value: number, digits: number): number =>
	(Math.sign(value) * Math.round(Math.abs(value) * 10 ** digits)) / 10 ** digits

const currencyText = (major: number, currency: string, options: Intl.NumberFormatOptions): string =>
	isKnownCurrency(currency)
		? numberFormat({ style: "currency", currency, ...options }).format(major)
		: `${numberFormat(options).format(major)} ${currency}`

const money = (minor: number, currency: string, signed: boolean, compact: boolean): string => {
	const major = minor / 10 ** fractionDigitsOf(currency)
	const text = currencyText(
		Math.abs(major),
		currency,
		compact
			? { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }
			: { minimumFractionDigits: 0, maximumFractionDigits: 0 },
	)
	return withSign(roundTo(major, compact ? 1 : 0), text, signed)
}

/** `45m`, `3h 20m`, `2d 4h` (`formatSlaDuration`). */
const duration = (ms: number): string => {
	const minutes = Math.max(0, Math.round(ms / MINUTE))
	if (minutes < 60) return `${Math.max(1, minutes)}m`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
	const days = Math.floor(minutes / (24 * 60))
	const rest = Math.floor((minutes % (24 * 60)) / 60)
	return rest === 0 ? `${days}d` : `${days}d ${rest}h`
}

export interface ChartFormatter {
	readonly value: (value: number) => string
	readonly axis: (value: number) => string
}

/**
 * The formatter for a chart. `signed` marks gains with `+` (a chart with losses below zero, such as
 * MRR movement, today's `formatMoney(value, currency, { signed: true })`).
 */
const compactNumber = (value: number) =>
	Math.abs(value) < 1
		? withSign(value, numberFormat({ maximumFractionDigits: 2 }).format(Math.abs(value)), false)
		: withSign(
				value,
				numberFormat({ notation: "compact", maximumFractionDigits: 1 }).format(Math.abs(value)),
				false,
			)

const percent = (value: number) => `${Math.round(value)}%`

const formatters = {
	currency: (currency, signed) => ({
		value: (value) => money(value, currency, signed, false),
		axis: (value) => money(value, currency, false, true),
	}),
	percent: () => ({ value: percent, axis: percent }),
	duration: () => ({
		value: duration,
		axis: (ms) =>
			ms === 0
				? "0"
				: ms < HOUR
					? `${Math.round(ms / MINUTE)}m`
					: `${Math.round((ms / HOUR) * 10) / 10}h`,
	}),
	number: (_currency, signed) => ({
		value: (value) =>
			withSign(value, numberFormat({ maximumFractionDigits: 2 }).format(Math.abs(value)), signed),
		// `formatCompact`, but a tick under 1 keeps its decimals (`0.5`).
		axis: compactNumber,
	}),
} satisfies Record<ChartFormat, (currency: string, signed: boolean) => ChartFormatter>

/**
 * The formatter for a chart. `signed` marks gains with `+` (a chart with losses below zero, such as
 * MRR movement, today's `formatMoney(value, currency, { signed: true })`).
 */
export const chartFormatter = (format: ChartFormat, currency: string, signed: boolean): ChartFormatter =>
	formatters[format](currency, signed)
