/**
 * Revenue classification and the numbers built on it (`docs/customers/revenue.md`): the defaults,
 * rules (first match, every condition, metadata lookup order), the basis fingerprint, trailing usage
 * (service-period attribution, the divisor) and the revenue split.
 */
import type { schema } from "@hazel/db"
import {
	type ClassifiableLine,
	classifyLine,
	type InvoiceLineDoc,
	type RevenueRule,
	revenueBasisOf,
} from "@hazel/domain/customers"
import { describe, expect, it } from "vitest"
import { addRevenue, emptySplit, makeRevenueBasis, recurringMrrOf, trailingUsageOf, windowMonths } from "./revenue"

const NOW = new Date("2026-06-15T12:00:00.000Z")

const price = (overrides: Partial<schema.CustomerPrice>): schema.CustomerPrice => ({
	provider: "stripe",
	externalId: "price_x",
	productId: "prod_x",
	productName: null,
	nickname: null,
	lookupKey: null,
	priceType: "recurring",
	usageType: "licensed",
	billingScheme: "per_unit",
	currency: "usd",
	unitAmountMinor: 1_000,
	interval: "month",
	intervalCount: 1,
	active: true,
	metadata: {},
	productMetadata: {},
	observedAt: null,
	createdAt: NOW,
	updatedAt: NOW,
	...overrides,
})

const CATALOG = [
	price({ externalId: "price_seat", productId: "prod_seat", metadata: { tier: "core" } }),
	price({ externalId: "price_api", productId: "prod_api", usageType: "metered", productMetadata: { family: "usage" } }),
	price({ externalId: "price_gb", productId: "prod_gb", billingScheme: "tiered" }),
	price({ externalId: "price_setup", productId: "prod_setup", priceType: "one_time", usageType: null }),
]

const basisOf = (rules: ReadonlyArray<RevenueRule> = [], months = 3) =>
	makeRevenueBasis(rules, months, "usd", CATALOG)

const classify = (line: Partial<ClassifiableLine>, rules: ReadonlyArray<RevenueRule> = []) => {
	const basis = basisOf(rules)
	return classifyLine(
		{ source: "subscription", proration: false, priceId: null, productId: null, metadata: {}, ...line },
		basis.rules,
		basis.catalog,
	)
}

const rule = (id: string, conditions: RevenueRule["conditions"], classification: RevenueRule["classification"]) => ({
	id,
	name: id,
	conditions,
	classification,
})

describe("classification defaults (Stripe's pricing semantics)", () => {
	it("classes metered and tiered prices variable, licensed recurring, one-time one-off", () => {
		expect(classify({ priceId: "price_api" }).classification).toBe("variable")
		expect(classify({ priceId: "price_gb" }).classification).toBe("variable")
		expect(classify({ priceId: "price_seat" }).classification).toBe("recurring")
		expect(classify({ priceId: "price_setup", source: "invoice_item" }).classification).toBe("one_off")
	})

	it("falls back to the line's own price fields, then its source, for a price not in the catalog", () => {
		expect(classify({ priceId: "price_new", usageType: "metered" }).classification).toBe("variable")
		expect(classify({ priceId: "price_new" }).classification).toBe("recurring")
		expect(classify({ priceId: null, source: "invoice_item" }).classification).toBe("one_off")
	})

	it("classes a proration by its price", () => {
		expect(classify({ priceId: "price_seat", proration: true })).toEqual({
			classification: "recurring",
			ruleId: null,
		})
	})
})

describe("classification rules", () => {
	it("takes the first rule whose every condition holds", () => {
		const rules = [
			rule("both", [
				{ field: "product", values: ["prod_api"] },
				{ field: "proration", values: ["true"] },
			], "excluded"),
			rule("api", [{ field: "product", values: ["prod_api"] }], "recurring"),
			rule("later", [{ field: "usage_type", values: ["metered"] }], "one_off"),
		]
		expect(classify({ priceId: "price_api", productId: "prod_api" }, rules)).toEqual({
			classification: "recurring",
			ruleId: "api",
		})
		expect(classify({ priceId: "price_api", productId: "prod_api", proration: true }, rules).ruleId).toBe("both")
	})

	it("matches a product from the catalog when the line names only its price", () => {
		expect(
			classify({ priceId: "price_api" }, [rule("api", [{ field: "product", values: ["prod_api"] }], "one_off")])
				.classification,
		).toBe("one_off")
	})

	it("reads metadata from the line, then the price, then the product", () => {
		const rules = [
			rule("usage", [{ field: "metadata", key: "family", values: ["usage"] }], "one_off"),
			rule("core", [{ field: "metadata", key: "tier", values: ["core"] }], "excluded"),
		]
		expect(classify({ priceId: "price_api" }, rules).ruleId).toBe("usage")
		expect(classify({ priceId: "price_seat" }, rules).ruleId).toBe("core")
		expect(classify({ priceId: "price_seat", metadata: { tier: "add-on" } }, rules).ruleId).toBeNull()
	})

	it("matches the line's source, so invoice items can be told from subscription items", () => {
		const rules = [rule("items", [{ field: "line_source", values: ["invoice_item"] }], "excluded")]
		expect(classify({ priceId: "price_seat", source: "invoice_item" }, rules).classification).toBe("excluded")
		expect(classify({ priceId: "price_seat" }, rules).classification).toBe("recurring")
	})
})

describe("the revenue basis", () => {
	const rules = [rule("api", [{ field: "product", values: ["prod_api"] }], "recurring")]

	it("is stable, ignores rule names, and changes with the rules, window, currency or method", () => {
		const key = revenueBasisOf(rules, 3, "usd", 1)
		expect(revenueBasisOf([{ ...rules[0], name: "renamed" }], 3, "usd", 1)).toBe(key)
		expect(revenueBasisOf([], 3, "usd", 1)).not.toBe(key)
		expect(revenueBasisOf(rules, 6, "usd", 1)).not.toBe(key)
		expect(revenueBasisOf(rules, 3, "eur", 1)).not.toBe(key)
		expect(revenueBasisOf(rules, 3, "usd", 2)).not.toBe(key)
	})
})

const line = (overrides: Partial<InvoiceLineDoc>): InvoiceLineDoc => ({
	externalId: "il",
	source: "subscription",
	proration: false,
	priceId: "price_api",
	productId: "prod_api",
	description: null,
	quantity: null,
	amountMinor: 0,
	periodStart: null,
	periodEnd: null,
	metadata: {},
	...overrides,
})

const invoice = (lines: ReadonlyArray<InvoiceLineDoc>, overrides: Partial<schema.CustomerInvoice> = {}) => ({
	status: "paid" as const,
	currency: "usd",
	issuedAt: new Date("2026-06-01T00:00:00.000Z"),
	paidAt: new Date("2026-06-01T00:00:00.000Z"),
	amountPaidMinor: 0,
	servicePeriodStart: new Date("2026-01-01T00:00:00.000Z"),
	lines,
	...overrides,
})

describe("trailing usage", () => {
	it("is the N full calendar months before the current one", () => {
		expect(windowMonths(NOW, 3).map((ms) => new Date(ms).toISOString().slice(0, 10))).toEqual([
			"2026-03-01",
			"2026-04-01",
			"2026-05-01",
		])
	})

	it("spreads a line over its service period: an annual usage line counts a twelfth a month", () => {
		const annual = line({
			amountMinor: 120_000,
			periodStart: "2026-01-01T00:00:00.000Z",
			periodEnd: "2027-01-01T00:00:00.000Z",
		})
		const usage = trailingUsageOf([invoice([annual])], basisOf(), "usd", NOW)
		// March, April, May: 31 + 30 + 31 days of 365, averaged over 3 months.
		expect(usage.variableMinor).toBe(Math.round((120_000 * 92) / 365 / 3))
	})

	it("averages a variable price only into variable, a recurring usage price only into recurring usage", () => {
		const may = { periodStart: "2026-05-01T00:00:00.000Z", periodEnd: "2026-06-01T00:00:00.000Z" }
		const lines = [
			line({ ...may, amountMinor: 9_000 }),
			line({ ...may, priceId: "price_gb", productId: "prod_gb", amountMinor: 3_000 }),
			line({ ...may, priceId: "price_seat", productId: "prod_seat", amountMinor: 50_000 }),
		]
		const rules = [rule("gb", [{ field: "price", values: ["price_gb"] }], "recurring")]
		const usage = trailingUsageOf([invoice(lines)], basisOf(rules), "usd", NOW)
		// The seat line is recurring at a fixed price: MRR has it from the subscription, not here.
		expect(usage).toEqual({ variableMinor: 3_000, recurringUsageMinor: 1_000, billedLastMonth: true })
	})

	it("is nothing for a customer first billed this month", () => {
		const june = line({ amountMinor: 9_000, periodStart: "2026-06-01T00:00:00.000Z", periodEnd: "2026-07-01T00:00:00.000Z" })
		expect(
			trailingUsageOf(
				[invoice([june], { servicePeriodStart: new Date("2026-06-01T00:00:00.000Z") })],
				basisOf(),
				"usd",
				NOW,
			).variableMinor,
		).toBe(0)
	})
})

describe("revenue split", () => {
	it("adds lines by class, leaves excluded out, and an invoice without lines unclassified", () => {
		const basis = basisOf([rule("setup", [{ field: "price", values: ["price_setup"] }], "excluded")])
		const split = emptySplit()
		addRevenue(
			split,
			invoice([
				line({ amountMinor: 4_000 }),
				line({ priceId: "price_seat", productId: "prod_seat", amountMinor: 10_000 }),
				line({ priceId: "price_seat", productId: "prod_seat", proration: true, amountMinor: -2_500 }),
				line({ priceId: null, productId: null, source: "invoice_item", amountMinor: 700 }),
				line({ priceId: "price_setup", source: "invoice_item", amountMinor: 30_000 }),
			]),
			basis,
		)
		addRevenue(split, invoice([], { lines: null, amountPaidMinor: 1_200 }), basis)
		expect(split).toEqual({ recurring: 7_500, variable: 4_000, oneOff: 700, unclassified: 1_200 })
	})
})

describe("recurring MRR of a subscription", () => {
	const sub = (items: schema.CustomerSubscription["items"]) => ({ items, mrrMinor: 25_000 })
	const item = (priceId: string, monthlyMinor: number | null) => ({
		externalId: priceId,
		priceId,
		productId: null,
		quantity: 1,
		monthlyMinor,
		listMonthlyMinor: monthlyMinor,
		lookupKey: null,
		usageType: null,
		billingScheme: null,
		metadata: {},
	})

	it("sums the recurring fixed-price items; without items it is the subscription's MRR", () => {
		const items = [item("price_seat", 20_000), item("price_api", null), item("price_x", 5_000)]
		expect(recurringMrrOf(sub(items), basisOf())).toBe(25_000)
		expect(
			recurringMrrOf(sub(items), basisOf([rule("x", [{ field: "price", values: ["price_x"] }], "one_off")])),
		).toBe(20_000)
		expect(recurringMrrOf(sub(null), basisOf())).toBe(25_000)
	})
})
