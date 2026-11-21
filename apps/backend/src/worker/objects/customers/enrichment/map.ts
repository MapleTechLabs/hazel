/**
 * context.dev's Brand profile and Company Search result → one `CompanyProfile`. Brand is the
 * reliable, domain-keyed lookup (identity, industry, headcount, address, socials, logo); a search
 * result only counts when its domain is the same company's, and adds what Brand lacks (founded
 * year, company type, funding, revenue), never replacing what Brand had. Only `https:` links are
 * kept, and colours only as `#rrggbb`.
 */
import type { CompanyLink, CompanyProfile, EmployeeRange } from "@hazel/domain/customers"
import type { BrandProfile, CompanyResult } from "./wire"

/** `www.acme.com`, `ACME.com.` → `acme.com`. */
export const normalizeDomain = (domain: string): string =>
	domain
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.replace(/\/.*$/, "")
		.replace(/\.$/, "")
		.replace(/^www\./, "")

const text = (value: string | null | undefined): string | null => {
	const trimmed = value?.trim() ?? ""
	return trimmed === "" ? null : trimmed
}

const httpsUrl = (value: string | null | undefined): string | null => {
	const url = text(value)
	if (url === null) return null
	try {
		return new URL(url).protocol === "https:" ? url : null
	} catch {
		return null
	}
}

const HEX = /^#[0-9a-f]{6}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A `YYYY-MM-DD` that is a real day; anything else (a year, a month, a timestamp) is dropped. */
const dayOf = (value: string | null | undefined): string | null => {
	const day = text(value)
	if (day === null || !DAY.test(day)) return null
	// A day that does not exist (`2025-02-29`) parses as another one: it must come back the same.
	const ms = Date.parse(`${day}T00:00:00Z`)
	return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === day ? day : null
}

const BRAND_RANGES: ReadonlyArray<readonly [string, EmployeeRange]> = [
	["1 to 10", "1-10"],
	["11 to 50", "11-50"],
	["51 to 200", "51-200"],
	["201 to 500", "201-500"],
	["501 to 1000", "501-1000"],
	["1001 to 5000", "1001-5000"],
	["5001 to 10000", "5001-10000"],
	["10001+", "10001+"],
]

/** The bucket a headcount falls in. */
export const rangeOfCount = (count: number): EmployeeRange =>
	count <= 10
		? "1-10"
		: count <= 50
			? "11-50"
			: count <= 200
				? "51-200"
				: count <= 500
					? "201-500"
					: count <= 1000
						? "501-1000"
						: count <= 5000
							? "1001-5000"
							: count <= 10000
								? "5001-10000"
								: "10001+"

const brandRange = (range: string | null | undefined): EmployeeRange | null => {
	const normal = text(range)?.toLowerCase()
	return BRAND_RANGES.find(([label]) => label === normal)?.[1] ?? null
}

/** A search result's headcount: its exact count, else the bucket its `min`..`max` fits. */
const searchRange = (employees: CompanyResult["employees"]): EmployeeRange | null => {
	if (employees == null) return null
	if (employees.count != null && employees.count > 0) return rangeOfCount(employees.count)
	if (
		employees.min != null &&
		employees.max != null &&
		employees.max >= employees.min &&
		employees.min > 0
	) {
		const low = rangeOfCount(employees.min)
		return low === rangeOfCount(employees.max) ? low : null
	}
	return null
}

/** The square icon in light mode when there is one, else any icon, else any logo. */
const logoOf = (logos: BrandProfile["logos"]): string | null => {
	const candidates = (logos ?? []).filter((logo) => httpsUrl(logo.url) !== null)
	const pick =
		candidates.find((logo) => logo.type === "icon" && logo.mode === "light") ??
		candidates.find((logo) => logo.type === "icon") ??
		candidates.find((logo) => logo.type === "logo" && logo.mode === "light") ??
		candidates[0]
	return httpsUrl(pick?.url)
}

const linksOf = (
	entries: ReadonlyArray<readonly [string, string | null | undefined]>,
): Array<CompanyLink> => {
	const seen = new Set<string>()
	const links: Array<CompanyLink> = []
	for (const [type, value] of entries) {
		const url = httpsUrl(value)
		const key = text(type)?.toLowerCase()
		if (url === null || key === undefined || seen.has(key)) continue
		seen.add(key)
		links.push({ type: key, url })
	}
	return links
}

/** Whether a search result is the company at `domain` (subdomains of either count). */
export const isSameCompany = (result: CompanyResult, domain: string): boolean => {
	const theirs = text(result.domain)
	if (theirs === null) return false
	const a = normalizeDomain(theirs)
	const b = normalizeDomain(domain)
	return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

const positiveInt = (value: number | null | undefined): number | null =>
	value != null && Number.isFinite(value) && value > 0 ? Math.round(value) : null

const usd = (value: number | null | undefined): number | null =>
	value != null && Number.isFinite(value) && value >= 0 ? value : null

/**
 * The profile of `domain` from whatever was found; null when neither says anything (a Brand miss
 * and no matching search result).
 */
export const toCompanyProfile = (
	domain: string,
	brand: BrandProfile | null,
	search: CompanyResult | null,
): CompanyProfile | null => {
	if (brand === null && search === null) return null
	const eic = brand?.industries?.eic?.find((entry) => text(entry.industry) !== null) ?? null
	const address = brand?.address ?? null
	const hq = search?.headquarters ?? null
	const headquarters =
		address !== null && (text(address.city) !== null || text(address.country) !== null)
			? {
					street: text(address.street),
					city: text(address.city),
					region: text(address.state_province),
					postalCode: text(address.postal_code),
					country: text(address.country),
					countryCode: text(address.country_code)?.toUpperCase() ?? null,
				}
			: hq !== null && (text(hq.city) !== null || text(hq.country_code) !== null)
				? {
						street: text(hq.street_address),
						city: text(hq.city),
						region: text(hq.region),
						postalCode: text(hq.postal_code),
						country: null,
						countryCode: text(hq.country_code)?.toUpperCase() ?? null,
					}
				: null
	const funding = search?.funding ?? null
	const rounds = (funding?.rounds ?? []).flatMap((round) => {
		const type = text(round.type)
		return type === null ? [] : [{ type, date: dayOf(round.date), amountUsd: usd(round.amount_usd) }]
	})
	const hasFunding =
		funding !== null &&
		(text(funding.stage) !== null || usd(funding.total_usd) !== null || rounds.length > 0)
	const revenue = search?.revenue ?? null
	const ticker = text(brand?.stock?.ticker)
	const exactCount = positiveInt(brand?.employees?.exact) ?? positiveInt(search?.employees?.count)
	return {
		domain: normalizeDomain(text(brand?.domain) ?? text(search?.domain) ?? domain),
		name: text(brand?.title) ?? text(search?.name),
		description: text(brand?.description) ?? text(search?.description),
		industry: text(eic?.industry) ?? text(search?.industries?.[0]),
		subindustry: text(eic?.subindustry),
		// A known headcount decides the bucket: sources' ranges lag it (PostHog: `51 to 200`, 234 people).
		employeeRange:
			exactCount === null
				? (brandRange(brand?.employees?.range) ?? searchRange(search?.employees))
				: rangeOfCount(exactCount),
		employeeCount: exactCount,
		headquarters,
		foundedYear: positiveInt(search?.founded_year),
		companyType: text(search?.organization_type) ?? (ticker === null ? null : "public_company"),
		operatingStatus: text(search?.operating_status),
		stock: ticker === null ? null : { ticker, exchange: text(brand?.stock?.exchange) },
		funding: hasFunding
			? { stage: text(funding?.stage), totalUsd: usd(funding?.total_usd), rounds }
			: null,
		revenue:
			revenue !== null && (usd(revenue.min_usd) !== null || usd(revenue.max_usd) !== null)
				? { minUsd: usd(revenue.min_usd), maxUsd: usd(revenue.max_usd) }
				: null,
		socials: linksOf([
			...(brand?.socials ?? []).map((social) => [social.type ?? "", social.url] as const),
			...Object.entries(search?.socials ?? {}),
		]),
		pages: linksOf(Object.entries(brand?.links ?? {})),
		colors: (brand?.colors ?? [])
			.map((color) => text(color.hex)?.toLowerCase() ?? "")
			.filter((hex) => HEX.test(hex))
			.slice(0, 6),
		logoUrl: logoOf(brand?.logos),
	}
}
