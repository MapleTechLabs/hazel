import { enrichmentDomainOf } from "@hazel/domain/customers"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { northwindBrand, northwindSearch } from "./fixtures"
import { isSameCompany, normalizeDomain, rangeOfCount, toCompanyProfile } from "./map"
import { BrandResponse, CompanySearchResponse } from "./wire"

const brand = Schema.decodeUnknownSync(BrandResponse)(northwindBrand).brand!
const results = Schema.decodeUnknownSync(CompanySearchResponse)(northwindSearch).results!
const match = results.find((result) => isSameCompany(result, "northwind.dev"))!

describe("company profile mapping", () => {
	it("takes identity from Brand and adds what only the search knows", () => {
		const profile = toCompanyProfile("northwind.dev", brand, match)!
		expect(profile).toMatchObject({
			domain: "northwind.dev",
			name: "Northwind Labs",
			industry: "Technology",
			subindustry: "Software (B2B)",
			employeeRange: "201-500",
			employeeCount: 312,
			headquarters: { city: "Berlin", country: "Germany", countryCode: "DE", street: "Torstraße 140" },
			foundedYear: 2019,
			companyType: "privately_held",
			operatingStatus: "active",
			stock: null,
			funding: {
				stage: "series_b",
				totalUsd: 58_000_000,
				rounds: [
					{ type: "series_b", date: "2026-03-10", amountUsd: 40_000_000 },
					{ type: "series_a", date: "2023-06-01", amountUsd: 14_000_000 },
					{ type: "seed", date: "2020-02-01", amountUsd: null },
				],
			},
			revenue: { minUsd: 20_000_000, maxUsd: 50_000_000 },
			// The light icon beats the dark logo.
			logoUrl: "https://media.context.dev/northwind/icon.png",
		})
	})

	it("keeps only https links, once per kind, and only #rrggbb colours", () => {
		const profile = toCompanyProfile("northwind.dev", brand, match)!
		expect(profile.socials).toEqual([
			{ type: "linkedin", url: "https://www.linkedin.com/company/northwind" },
			{ type: "x", url: "https://x.com/northwind" },
			{ type: "crunchbase", url: "https://www.crunchbase.com/organization/northwind" },
		])
		expect(profile.pages).toEqual([
			{ type: "careers", url: "https://northwind.dev/careers" },
			{ type: "pricing", url: "https://northwind.dev/pricing" },
		])
		expect(profile.colors).toEqual(["#4f46e5"])
	})

	it("only trusts a search result at the same domain", () => {
		expect(
			results.filter((result) => isSameCompany(result, "northwind.dev")).map((result) => result.name),
		).toEqual(["Northwind Labs"])
		expect(isSameCompany({ domain: "app.northwind.dev" }, "northwind.dev")).toBe(true)
		expect(isSameCompany({ domain: "northwind.io" }, "northwind.dev")).toBe(false)
		expect(isSameCompany({ domain: null }, "northwind.dev")).toBe(false)
	})

	it("stands on Brand alone, and on nothing is null", () => {
		const profile = toCompanyProfile("northwind.dev", brand, null)!
		expect(profile.foundedYear).toBeNull()
		expect(profile.funding).toBeNull()
		expect(profile.revenue).toBeNull()
		expect(profile.employeeRange).toBe("201-500")
		expect(toCompanyProfile("northwind.dev", null, null)).toBeNull()
	})

	it("keeps a round's date only as a real YYYY-MM-DD", () => {
		const rounds = (dates: ReadonlyArray<string>) =>
			toCompanyProfile("northwind.dev", brand, {
				...match,
				funding: {
					stage: "seed",
					total_usd: null,
					rounds: dates.map((date) => ({ type: "seed", date })),
				},
			})!.funding!.rounds.map((round) => round.date)
		expect(rounds(["2021-03-04", "2021", "2021-03", "2021-03-04T10:00:00Z", "2021-13-45"])).toEqual([
			"2021-03-04",
			null,
			null,
			null,
			null,
		])
	})

	it("takes the bucket from a known headcount over a lagging range", () => {
		const lagging = { ...brand, employees: { range: "51 to 200", exact: 234 } }
		expect(toCompanyProfile("posthog.com", lagging, null)).toMatchObject({
			employeeRange: "201-500",
			employeeCount: 234,
		})
	})

	it("buckets headcounts and leaves a range spanning buckets unknown", () => {
		expect([1, 10, 11, 200, 201, 10_000, 10_001].map(rangeOfCount)).toEqual([
			"1-10",
			"1-10",
			"11-50",
			"51-200",
			"201-500",
			"5001-10000",
			"10001+",
		])
		const wide = toCompanyProfile("x.io", null, {
			name: "X",
			domain: "x.io",
			employees: { min: 11, max: 200 },
		})!
		expect(wide.employeeRange).toBeNull()
	})

	it("normalizes domains and never enriches a mail provider's", () => {
		expect(normalizeDomain(" https://WWW.Acme.com./pricing ")).toBe("acme.com")
		expect(enrichmentDomainOf(["gmail.com", "Acme.com"])).toBe("acme.com")
		expect(enrichmentDomainOf(["gmail.com", "pm.me"])).toBeNull()
		expect(enrichmentDomainOf([])).toBeNull()
	})
})
