import { Color, Icon } from "@raycast/api"
import type { CustomerSource, HealthStatus, LifecycleStage } from "./models"

/** An amount in minor units (cents; whole yen) as currency. */
export const money = (minor: number, currency: string) => {
	const format = new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() })
	const digits = format.resolvedOptions().maximumFractionDigits ?? 2
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: currency.toUpperCase(),
		maximumFractionDigits: minor % 10 ** digits === 0 ? 0 : digits,
	}).format(minor / 10 ** digits)
}

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
	["year", 365 * 24 * 3600],
	["month", 30 * 24 * 3600],
	["week", 7 * 24 * 3600],
	["day", 24 * 3600],
	["hour", 3600],
	["minute", 60],
]

/** "3 days ago", "in 2 weeks"; "just now" under a minute. */
export const relative = (iso: string, now = Date.now()) => {
	const seconds = (new Date(iso).getTime() - now) / 1000
	const unit = UNITS.find(([, size]) => Math.abs(seconds) >= size)
	if (unit === undefined) return "just now"
	return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
		Math.round(seconds / unit[1]),
		unit[0],
	)
}

/**
 * Text from providers and customers, inert in markdown: no images, links, emphasis, tables or
 * headings it did not ask for, and on one line.
 */
export const md = (text: string) =>
	text
		.replace(/\s+/g, " ")
		.replace(/[\\`*_[\]()!<>|#~]/g, "\\$&")
		// No bare-URL autolinks either (`https://…`, `www.…`).
		.replace(/:\/\//g, ":\\/\\/")
		.replace(/\bwww\./gi, "www\\.")

/** `url` when it is https; anything else is not shown or loaded. */
export const httpsUrl = (url: string | null) => {
	if (url === null) return null
	try {
		return new URL(url).protocol === "https:" ? url : null
	} catch {
		return null
	}
}

export const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })

export const HEALTH = {
	healthy: { label: "Healthy", color: Color.Green },
	at_risk: { label: "At risk", color: Color.Orange },
	critical: { label: "Critical", color: Color.Red },
	unknown: { label: "No score", color: Color.SecondaryText },
} satisfies Record<HealthStatus, { readonly label: string; readonly color: Color }>

export const STAGE = {
	lead: "Lead",
	trialing: "Trialing",
	active: "Active",
	past_due: "Past due",
	churned: "Churned",
} satisfies Record<LifecycleStage, string>

export const SOURCE = {
	clerk: { label: "Clerk", domain: "clerk.com" },
	stripe: { label: "Stripe", domain: "stripe.com" },
	autumn: { label: "Autumn", domain: "useautumn.com" },
	maple: { label: "Maple", domain: "maple.dev" },
	hazel: { label: "Hazel", domain: "hazel.sh" },
} satisfies Record<CustomerSource, { readonly label: string; readonly domain: string }>

/** The hosts a provider's record links may point to (`*.` any subdomain), as on the web. */
const LINK_HOSTS = {
	clerk: ["dashboard.clerk.com"],
	stripe: ["*.stripe.com"],
	autumn: ["*.useautumn.com"],
	maple: ["*.maple.dev"],
} satisfies Record<Exclude<CustomerSource, "hazel">, ReadonlyArray<string>>

/** `url` when it is an https link on the provider's own hosts; anything else is not opened. */
export const safeSourceUrl = (provider: Exclude<CustomerSource, "hazel">, url: string | null) => {
	if (url === null) return null
	try {
		const { protocol, hostname } = new URL(url)
		const own = LINK_HOSTS[provider].some((host) =>
			host.startsWith("*.") ? hostname.endsWith(host.slice(1)) : hostname === host,
		)
		return protocol === "https:" && own ? url : null
	} catch {
		return null
	}
}

/** The account's open risk count, and the icon its worst severity gets. */
export const risk = (account: {
	readonly openRiskHigh: number
	readonly openRiskMedium: number
	readonly openRiskLow: number
}) => {
	const count = account.openRiskHigh + account.openRiskMedium + account.openRiskLow
	const color =
		account.openRiskHigh > 0 ? Color.Red : account.openRiskMedium > 0 ? Color.Orange : Color.Yellow
	return { count, icon: { source: Icon.Warning, tintColor: color } }
}
