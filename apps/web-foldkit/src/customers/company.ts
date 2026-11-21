import { type CompanyLink, type CompanyProfile, EMPLOYEE_RANGE_LABEL } from "@hazel/domain/customers"
import { formatCount, formatMoneyCompact } from "./format"

/**
 * Labels for an account's enriched company profile (`docs/customers/enrichment.md`). Every field
 * may be missing: each label is null when there is nothing to say, and views show a dash.
 */

/** `201–500`, with the exact headcount when known: `201–500 · 312`. */
export const employeesLabel = (profile: CompanyProfile): string | null =>
	profile.employeeRange === null
		? profile.employeeCount === null
			? null
			: formatCount(profile.employeeCount)
		: EMPLOYEE_RANGE_LABEL[profile.employeeRange]

/** The flag of an ISO 3166-1 alpha-2 code: `DE` → 🇩🇪; empty for anything else. */
export const countryFlag = (code: string | null): string =>
	code !== null && /^[A-Za-z]{2}$/.test(code)
		? String.fromCodePoint(...[...code.toUpperCase()].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65))
		: ""

const regionNames = (() => {
	try {
		return new Intl.DisplayNames(["en"], { type: "region" })
	} catch {
		return null
	}
})()

/** `DE` → `Germany`; the code itself when the browser knows no name for it. */
export const countryNameOf = (code: string): string => {
	try {
		return regionNames?.of(code.toUpperCase()) ?? code
	} catch {
		return code
	}
}

/** The headquarters' country code, upper case (`DE`). */
export const countryCodeOf = (profile: CompanyProfile): string | null =>
	profile.headquarters?.countryCode?.toUpperCase() ?? null

/** `Germany`, from the profile or its country code. */
export const countryName = (profile: CompanyProfile): string | null => {
	const hq = profile.headquarters
	if (hq === null) return null
	if (hq.country !== null) return hq.country
	return hq.countryCode === null ? null : countryNameOf(hq.countryCode)
}

/** `Berlin, Germany`; the city or the country alone when only one is known. */
export const headquartersLabel = (profile: CompanyProfile): string | null => {
	const city = profile.headquarters?.city ?? null
	const country = countryName(profile)
	if (city === null) return country
	return country === null || country === city ? city : `${city}, ${country}`
}

/** One line of the address: `Torstraße 140, 10119 Berlin`. */
export const addressLabel = (profile: CompanyProfile): string | null => {
	const hq = profile.headquarters
	if (hq === null || hq.street === null) return null
	const place = [hq.postalCode, hq.city].filter((part) => part !== null).join(" ")
	return place === "" ? hq.street : `${hq.street}, ${place}`
}

/** `$58M`. */
export const usdLabel = (usd: number): string => formatMoneyCompact(Math.round(usd * 100), "USD")

const STAGE_WORDS = new Map([
	["pre_seed", "Pre-seed"],
	["seed", "Seed"],
	["angel", "Angel"],
	["ipo", "IPO"],
	["post_ipo_equity", "Post-IPO"],
	["private_equity", "Private equity"],
	["debt_financing", "Debt"],
	["grant", "Grant"],
	["convertible_note", "Convertible note"],
	["corporate_round", "Corporate round"],
	["undisclosed", "Undisclosed"],
])

/** `series_b` → `Series B`, `seed` → `Seed`, anything else as words. */
export const fundingStageLabel = (stage: string): string => {
	const known = STAGE_WORDS.get(stage)
	if (known !== undefined) return known
	const series = /^series_([a-z])(?:_?(\d+))?$/i.exec(stage)
	if (series !== null) return `Series ${(series[1] ?? "").toUpperCase()}${series[2] ?? ""}`
	const words = stage.replace(/_/g, " ").trim()
	return words.charAt(0).toUpperCase() + words.slice(1)
}

const EARLY_STAGES = ["pre_seed", "angel", "seed"]
const LATE_STAGES = ["ipo", "post_ipo_equity", "post_ipo_debt", "private_equity"]

/**
 * Where a stage falls in a company's life, for sorting: pre-seed, angel, seed, series A…Z (and their
 * extensions), then IPO and later; anything else (grants, debt, undisclosed) after those.
 */
export const fundingStageRank = (stage: string): number => {
	const early = EARLY_STAGES.indexOf(stage)
	if (early !== -1) return early
	const series = /^series_([a-z])(?:_?(\d+))?$/i.exec(stage)
	if (series !== null)
		return 10 + ((series[1] ?? "a").toLowerCase().charCodeAt(0) - 97) * 10 + Number(series[2] ?? 0)
	const late = LATE_STAGES.indexOf(stage)
	return late !== -1 ? 1_000 + late : 2_000
}

/** The stage as the source names it (`series_b`): the profile's, else its latest round's. */
export const fundingStageOf = (profile: CompanyProfile): string | null =>
	profile.funding === null ? null : (profile.funding.stage ?? profile.funding.rounds[0]?.type ?? null)

/** `Series B`, with what was raised in total: `Series B · $58M`. */
export const fundingLabel = (profile: CompanyProfile): string | null => {
	const funding = profile.funding
	if (funding === null) return null
	const stage = fundingStageOf(profile)
	const parts = [
		stage === null ? null : fundingStageLabel(stage),
		funding.totalUsd === null ? null : usdLabel(funding.totalUsd),
	]
	const text = parts.filter((part) => part !== null).join(" · ")
	return text === "" ? null : text
}

/** `$20M–$50M`, `$20M+`, `Under $50M`. */
export const revenueLabel = (profile: CompanyProfile): string | null => {
	const revenue = profile.revenue
	if (revenue === null) return null
	const { minUsd, maxUsd } = revenue
	if (minUsd !== null && maxUsd !== null)
		return minUsd === maxUsd ? usdLabel(minUsd) : `${usdLabel(minUsd)}–${usdLabel(maxUsd)}`
	if (minUsd !== null) return `${usdLabel(minUsd)}+`
	if (maxUsd !== null) return `Under ${usdLabel(maxUsd)}`
	return null
}

/** `Private`, `Public · NASDAQ:NWND`, … */
export const companyTypeLabel = (profile: CompanyProfile): string | null => {
	const type = profile.companyType
	const base =
		type === null
			? null
			: type === "privately_held"
				? "Private"
				: type === "public_company"
					? "Public"
					: type === "nonprofit"
						? "Nonprofit"
						: fundingStageLabel(type)
	const ticker =
		profile.stock === null
			? null
			: profile.stock.exchange === null
				? profile.stock.ticker
				: `${profile.stock.exchange}:${profile.stock.ticker}`
	const text = [base, ticker].filter((part) => part !== null).join(" · ")
	return text === "" ? null : text
}

const LINK_LABEL = new Map([
	["linkedin", "LinkedIn"],
	["x", "X"],
	["twitter", "X"],
	["github", "GitHub"],
	["crunchbase", "Crunchbase"],
	["producthunt", "Product Hunt"],
	["youtube", "YouTube"],
	["facebook", "Facebook"],
	["instagram", "Instagram"],
	["discord", "Discord"],
	["medium", "Medium"],
	["wellfound", "Wellfound"],
	["tiktok", "TikTok"],
	["careers", "Careers"],
	["pricing", "Pricing"],
	["blog", "Blog"],
	["contact", "Contact"],
	["privacy", "Privacy"],
	["terms", "Terms"],
])

export const linkLabel = (link: CompanyLink): string =>
	LINK_LABEL.get(link.type) ?? fundingStageLabel(link.type)

/** The socials worth a chip, most useful first, at most `limit`. */
const SOCIAL_ORDER = ["linkedin", "x", "twitter", "github", "crunchbase", "producthunt", "youtube"]
export const headerSocials = (profile: CompanyProfile, limit = 3): ReadonlyArray<CompanyLink> =>
	[...profile.socials].sort((a, b) => rankOf(a.type) - rankOf(b.type)).slice(0, limit)

const rankOf = (type: string) => {
	const index = SOCIAL_ORDER.indexOf(type)
	return index === -1 ? SOCIAL_ORDER.length : index
}

/** The pages worth linking from the Company section. */
const PAGE_TYPES = ["careers", "pricing", "blog"]
export const companyPages = (profile: CompanyProfile): ReadonlyArray<CompanyLink> =>
	profile.pages.filter((page) => PAGE_TYPES.includes(page.type))
