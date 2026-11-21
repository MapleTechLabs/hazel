/**
 * A customer's company profile, enriched from its domain (context.dev, `docs/customers/enrichment.md`).
 * Kept apart from the fields providers sync: it never overwrites them, and the UI only falls back on
 * it (`logoUrl` when the account has none). Every field may be missing: small companies often have
 * no headcount, funding or revenue on record.
 */
import { Schema } from "effect"

/** Headcount buckets, smallest first (also the order the list sorts and filters them in). */
export const EmployeeRange = Schema.Literals([
	"1-10",
	"11-50",
	"51-200",
	"201-500",
	"501-1000",
	"1001-5000",
	"5001-10000",
	"10001+",
])
export type EmployeeRange = typeof EmployeeRange.Type

export const EMPLOYEE_RANGE_LABEL = {
	"1-10": "1–10",
	"11-50": "11–50",
	"51-200": "51–200",
	"201-500": "201–500",
	"501-1000": "501–1,000",
	"1001-5000": "1,001–5,000",
	"5001-10000": "5,001–10,000",
	"10001+": "10,001+",
} as const satisfies Record<EmployeeRange, string>

const Text = Schema.NullOr(Schema.String)

export const CompanyAddress = Schema.Struct({
	street: Text,
	city: Text,
	region: Text,
	postalCode: Text,
	country: Text,
	/** ISO 3166-1 alpha-2, upper case. */
	countryCode: Text,
})
export type CompanyAddress = typeof CompanyAddress.Type

export const FundingRound = Schema.Struct({
	/** `seed`, `series_a`, …: as the source names it. */
	type: Schema.String,
	/** `YYYY-MM-DD`. */
	date: Text,
	amountUsd: Schema.NullOr(Schema.Finite),
})
export type FundingRound = typeof FundingRound.Type

export const CompanyFunding = Schema.Struct({
	stage: Text,
	totalUsd: Schema.NullOr(Schema.Finite),
	/** Newest first. */
	rounds: Schema.Array(FundingRound),
})
export type CompanyFunding = typeof CompanyFunding.Type

export const CompanyLink = Schema.Struct({
	/** A social network (`linkedin`, `x`, `github`, …) or a page (`careers`, `pricing`, `blog`, …). */
	type: Schema.String,
	/** Always `https:`. */
	url: Schema.String,
})
export type CompanyLink = typeof CompanyLink.Type

export const CompanyProfile = Schema.Struct({
	/** The domain the profile is of (the lookup may resolve to the company's main domain). */
	domain: Schema.String,
	name: Text,
	description: Text,
	industry: Text,
	subindustry: Text,
	employeeRange: Schema.NullOr(EmployeeRange),
	/** Only when a precise headcount is known. */
	employeeCount: Schema.NullOr(Schema.Int),
	headquarters: Schema.NullOr(CompanyAddress),
	foundedYear: Schema.NullOr(Schema.Int),
	/** `public_company`, `privately_held`, …: as the source names it. */
	companyType: Text,
	/** `active`, `acquired`, `closed`. */
	operatingStatus: Text,
	stock: Schema.NullOr(Schema.Struct({ ticker: Schema.String, exchange: Text })),
	funding: Schema.NullOr(CompanyFunding),
	/** An estimated annual range. */
	revenue: Schema.NullOr(
		Schema.Struct({ minUsd: Schema.NullOr(Schema.Finite), maxUsd: Schema.NullOr(Schema.Finite) }),
	),
	socials: Schema.Array(CompanyLink),
	pages: Schema.Array(CompanyLink),
	/** Hex colours, the main one first. */
	colors: Schema.Array(Schema.String),
	/** A square icon, else the logo; `https:`. */
	logoUrl: Text,
})
export type CompanyProfile = typeof CompanyProfile.Type

/**
 * Mail providers: a domain of theirs says nothing about the company (account matching, channel
 * suggestions and enrichment all skip them).
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
	"gmail.com",
	"googlemail.com",
	"yahoo.com",
	"hotmail.com",
	"outlook.com",
	"live.com",
	"msn.com",
	"icloud.com",
	"me.com",
	"mac.com",
	"aol.com",
	"proton.me",
	"protonmail.com",
	"pm.me",
	"gmx.com",
	"gmx.de",
	"web.de",
	"yandex.com",
	"mail.com",
	"zoho.com",
	"fastmail.com",
	"hey.com",
	"qq.com",
	"163.com",
])

/** The domain an account's company profile is looked up by: its first one that is not a mail provider's. */
export const enrichmentDomainOf = (domains: ReadonlyArray<string>): string | null =>
	domains
		.map((domain) => domain.trim().toLowerCase())
		.find((domain) => domain !== "" && !FREE_MAIL_DOMAINS.has(domain)) ?? null

/** The logo to picture an account by: its own (synced or set by hand), else its company's. */
export const logoOf = (account: {
	readonly logoUrl: string | null
	readonly companyProfile: CompanyProfile | null
}): string | null => account.logoUrl ?? account.companyProfile?.logoUrl ?? null
