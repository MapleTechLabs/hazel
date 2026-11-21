import { describe, expect, it } from "vitest"
import { RICH_COMPANY, SPARSE_COMPANY } from "../lab/fixtures/customers"
import {
	addressLabel,
	companyPages,
	companyTypeLabel,
	countryFlag,
	employeesLabel,
	fundingLabel,
	fundingStageLabel,
	headerSocials,
	headquartersLabel,
	revenueLabel,
} from "./company"

describe("company profile labels", () => {
	it("labels a rich profile", () => {
		expect(employeesLabel(RICH_COMPANY)).toBe("201–500")
		expect(headquartersLabel(RICH_COMPANY)).toBe("Berlin, Germany")
		expect(addressLabel(RICH_COMPANY)).toBe("Torstraße 140, 10119 Berlin")
		expect(fundingLabel(RICH_COMPANY)).toBe("Series B · $58M")
		expect(revenueLabel(RICH_COMPANY)).toBe("$20M–$50M")
		expect(companyTypeLabel(RICH_COMPANY)).toBe("Private")
		expect(headerSocials(RICH_COMPANY).map((link) => link.type)).toEqual([
			"linkedin",
			"x",
			"github",
			"crunchbase",
		])
		expect(companyPages(RICH_COMPANY).map((link) => link.type)).toEqual(["careers", "pricing", "blog"])
	})

	it("says nothing for what a sparse profile lacks, and names a country from its code", () => {
		expect(headquartersLabel(SPARSE_COMPANY)).toBe("Lisbon, Portugal")
		expect(fundingLabel(SPARSE_COMPANY)).toBeNull()
		expect(revenueLabel(SPARSE_COMPANY)).toBeNull()
		expect(addressLabel(SPARSE_COMPANY)).toBeNull()
		expect(employeesLabel({ ...SPARSE_COMPANY, employeeRange: null })).toBeNull()
		expect(employeesLabel({ ...SPARSE_COMPANY, employeeRange: null, employeeCount: 1204 })).toBe("1,204")
	})

	it("formats stages, open revenue ranges, tickers and flags", () => {
		expect(
			["series_a", "series_c_2", "seed", "pre_seed", "post_ipo_equity", "venture_round"].map(
				fundingStageLabel,
			),
		).toEqual(["Series A", "Series C2", "Seed", "Pre-seed", "Post-IPO", "Venture round"])
		expect(revenueLabel({ ...RICH_COMPANY, revenue: { minUsd: 1_000_000, maxUsd: null } })).toBe("$1M+")
		expect(revenueLabel({ ...RICH_COMPANY, revenue: { minUsd: null, maxUsd: 5_000_000 } })).toBe(
			"Under $5M",
		)
		expect(
			companyTypeLabel({
				...RICH_COMPANY,
				companyType: "public_company",
				stock: { ticker: "NWND", exchange: "NASDAQ" },
			}),
		).toBe("Public · NASDAQ:NWND")
		expect(countryFlag("de")).toBe("🇩🇪")
		expect(countryFlag("Germany")).toBe("")
		expect(countryFlag(null)).toBe("")
	})
})
