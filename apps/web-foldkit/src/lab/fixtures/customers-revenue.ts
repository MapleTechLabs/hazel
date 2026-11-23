import type {
	RevenueCatalog,
	RevenuePreviewGroup,
	RevenuePreviewResult,
	RevenueRule,
} from "@hazel/domain/customers"

/** The revenue settings page's fixtures: a price catalog, saved rules, and a preview of a draft. */

const price = (
	priceId: string,
	productId: string,
	productName: string,
	nickname: string,
	fields: Partial<RevenueCatalog["prices"][number]> = {},
): RevenueCatalog["prices"][number] => ({
	priceId,
	productId,
	productName,
	nickname,
	lookupKey: null,
	priceType: "recurring",
	usageType: "licensed",
	billingScheme: "per_unit",
	currency: "usd",
	unitAmountMinor: 4_900,
	interval: "month",
	active: true,
	...fields,
})

export const REVENUE_CATALOG: RevenueCatalog = {
	prices: [
		price("price_platform", "prod_platform", "Platform", "Monthly", { lookupKey: "platform_monthly" }),
		price("price_seats", "prod_seats", "Seats", "Per seat", { lookupKey: "seats_monthly" }),
		price("price_api", "prod_api", "API usage", "Per 1,000 requests", {
			lookupKey: "api_metered",
			usageType: "metered",
			unitAmountMinor: null,
		}),
		price("price_storage", "prod_storage", "Storage", "Tiered", {
			billingScheme: "tiered",
			usageType: "metered",
			unitAmountMinor: null,
		}),
		price("price_onboarding", "prod_onboarding", "Onboarding", "One-time", {
			priceType: "one_time",
			usageType: null,
			interval: null,
			unitAmountMinor: 150_000,
		}),
	],
	metadataKeys: ["billing_kind", "contract", "region"],
}

export const REVENUE_RULES: ReadonlyArray<RevenueRule> = [
	{
		id: "rule-1",
		name: "Committed storage",
		conditions: [{ field: "product", values: ["prod_storage"] }],
		classification: "recurring",
	},
	{
		id: "rule-2",
		name: "Pass-through fees",
		conditions: [
			{ field: "line_source", values: ["invoice_item"] },
			{ field: "metadata", key: "billing_kind", values: ["pass_through"] },
		],
		classification: "excluded",
	},
]

const group = (
	label: string,
	detail: string | null,
	current: RevenuePreviewGroup["current"]["classification"],
	proposed: RevenuePreviewGroup["proposed"]["classification"],
	fields: Partial<RevenuePreviewGroup>,
): RevenuePreviewGroup => ({
	priceId: `price_${label.toLowerCase().replaceAll(" ", "_")}`,
	productId: null,
	label,
	detail,
	source: "subscription",
	proration: false,
	usageType: null,
	billingScheme: null,
	lineCount: 0,
	amountMinor: 0,
	itemCount: 0,
	monthlyMinor: 0,
	current: { classification: current, ruleId: null },
	proposed: { classification: proposed, ruleId: null },
	...fields,
})

/** The saved rules' preview: nothing moves. */
export const REVENUE_PREVIEW: RevenuePreviewResult = {
	currency: "USD",
	current: { mrrMinor: 4_821_000, variableMrrMinor: 216_000 },
	proposed: { mrrMinor: 4_821_000, variableMrrMinor: 216_000 },
	groups: [
		group("Platform", "Monthly", "recurring", "recurring", {
			lineCount: 412,
			amountMinor: 9_840_000,
			itemCount: 176,
			monthlyMinor: 3_280_000,
		}),
		group("Seats", "Per seat", "recurring", "recurring", {
			lineCount: 388,
			amountMinor: 4_620_000,
			itemCount: 151,
			monthlyMinor: 1_541_000,
		}),
		group("API usage", "Per 1,000 requests", "variable", "variable", {
			usageType: "metered",
			lineCount: 204,
			amountMinor: 648_000,
			itemCount: 64,
		}),
		group("Storage", "Tiered", "recurring", "recurring", {
			billingScheme: "tiered",
			lineCount: 96,
			amountMinor: 312_000,
			itemCount: 31,
		}),
		group("Onboarding", "One-time", "one_off", "one_off", {
			source: "invoice_item",
			lineCount: 9,
			amountMinor: 1_350_000,
		}),
		group("Seats", "Per seat", "recurring", "recurring", {
			priceId: "price_seats_proration",
			source: "invoice_item",
			proration: true,
			lineCount: 31,
			amountMinor: -84_000,
		}),
	],
}

/** The first rule dropped: storage goes back to variable, and MRR with it. */
export const REVENUE_DRAFT_PREVIEW: RevenuePreviewResult = {
	...REVENUE_PREVIEW,
	proposed: { mrrMinor: 4_717_000, variableMrrMinor: 320_000 },
	groups: REVENUE_PREVIEW.groups.map((entry) =>
		entry.label === "Storage"
			? { ...entry, proposed: { classification: "variable", ruleId: null } }
			: entry,
	),
}
