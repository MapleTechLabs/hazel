/**
 * Revenue classification (`docs/customers/revenue.md`): every billing line (a subscription item or an
 * invoice line) is `recurring`, `variable`, `one_off` or `excluded`, by the org's ordered rules, else
 * by Stripe's own pricing semantics. Pure, so the backend's compute and reads and the settings
 * page's preview classify a line the same way.
 */
import { Schema } from "effect"

export const RevenueClass = Schema.Literals(["recurring", "variable", "one_off", "excluded"])
export type RevenueClass = typeof RevenueClass.Type

/** What generated a line: a subscription item, or an invoice item (one-off, or added to a subscription's invoice). */
export const BillingLineSource = Schema.Literals(["subscription", "invoice_item"])
export type BillingLineSource = typeof BillingLineSource.Type

export const RevenueConditionField = Schema.Literals([
	"product",
	"price",
	"lookup_key",
	"usage_type",
	"billing_scheme",
	"price_type",
	"line_source",
	"proration",
	"metadata",
])
export type RevenueConditionField = typeof RevenueConditionField.Type

const Value = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500))

/**
 * Holds when the line's `field` is one of `values` (`metadata`: the value under `key`, from the
 * line's metadata, else its price's, else its product's). `proration` takes `"true"`/`"false"`.
 */
export const RevenueCondition = Schema.Struct({
	field: RevenueConditionField,
	/** The metadata key; required for `metadata`, which could match nothing without one. */
	key: Schema.optionalKey(Value),
	values: Schema.Array(Value).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
}).check(
	Schema.makeFilter((condition) =>
		condition.field !== "metadata" || (condition.key ?? "").trim() !== ""
			? undefined
			: "A metadata condition needs a key",
	),
)
export type RevenueCondition = typeof RevenueCondition.Type

export const RevenueRule = Schema.Struct({
	/** Stable across edits: what a preview names as the rule that matched. */
	id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
	name: Schema.String.check(Schema.isMaxLength(200)),
	/** All must hold; at least one. */
	conditions: Schema.Array(RevenueCondition).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
	classification: RevenueClass,
})
export type RevenueRule = typeof RevenueRule.Type

export const MAX_REVENUE_RULES = 100
export const RevenueRules = Schema.Array(RevenueRule).check(Schema.isMaxLength(MAX_REVENUE_RULES))

/** How many full calendar months variable MRR averages over. */
export const VariableMrrMonths = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 }))
export const DEFAULT_VARIABLE_MRR_MONTHS = 3

/** A price as Hazel's catalog holds it (Stripe's price with its product's name and metadata). */
export interface CatalogPrice {
	readonly priceId: string
	readonly productId: string | null
	readonly lookupKey: string | null
	/** `licensed` or `metered`; null for a one-time price. */
	readonly usageType: string | null
	/** `per_unit` or `tiered`. */
	readonly billingScheme: string | null
	/** `recurring` or `one_time`. */
	readonly priceType: string | null
	readonly metadata: Readonly<Record<string, string>>
	readonly productMetadata: Readonly<Record<string, string>>
}

/** One line as classification sees it: what the line says, and its price from the catalog when known. */
export interface ClassifiableLine {
	readonly source: BillingLineSource
	readonly proration: boolean
	readonly priceId: string | null
	readonly productId: string | null
	readonly metadata: Readonly<Record<string, string>>
	/** What the line itself knows of its price (a subscription item's expanded price); the catalog's wins. */
	readonly lookupKey?: string | null
	readonly usageType?: string | null
	readonly billingScheme?: string | null
	readonly priceType?: string | null
}

export interface Classified {
	readonly classification: RevenueClass
	/** The rule that decided; null for the defaults. */
	readonly ruleId: string | null
}

/** The line's value of `field` as rules compare it; null when the line has none. */
const valueOf = (
	line: ClassifiableLine,
	price: CatalogPrice | undefined,
	condition: RevenueCondition,
): string | null => {
	switch (condition.field) {
		case "product":
			return line.productId ?? price?.productId ?? null
		case "price":
			return line.priceId
		case "lookup_key":
			return price?.lookupKey ?? line.lookupKey ?? null
		case "usage_type":
			return price?.usageType ?? line.usageType ?? null
		case "billing_scheme":
			return price?.billingScheme ?? line.billingScheme ?? null
		case "price_type":
			return price?.priceType ?? line.priceType ?? null
		case "line_source":
			return line.source
		case "proration":
			return line.proration ? "true" : "false"
		case "metadata": {
			const key = condition.key ?? ""
			return line.metadata[key] ?? price?.metadata[key] ?? price?.productMetadata[key] ?? null
		}
	}
}

const holds = (line: ClassifiableLine, price: CatalogPrice | undefined, condition: RevenueCondition) => {
	const value = valueOf(line, price, condition)
	return value !== null && condition.values.includes(value)
}

/** Billed by usage: metered, or tiered (its amount is on the tiers, not the price). */
export const isUsagePriced = (line: ClassifiableLine, price: CatalogPrice | undefined): boolean =>
	(price?.usageType ?? line.usageType) === "metered" ||
	(price?.billingScheme ?? line.billingScheme) === "tiered"

/**
 * Stripe's semantics: usage-priced → variable; a recurring price or a subscription item → recurring;
 * anything else (a one-time price, an invoice item without a price) → one-off. A proration follows
 * its price.
 */
export const defaultClassOf = (line: ClassifiableLine, price: CatalogPrice | undefined): RevenueClass => {
	if (isUsagePriced(line, price)) return "variable"
	const priceType = price?.priceType ?? line.priceType ?? null
	if (priceType === "recurring") return "recurring"
	if (priceType === "one_time") return "one_off"
	return line.source === "subscription" ? "recurring" : "one_off"
}

/** The first rule whose conditions all hold, else the defaults. */
export const classifyLine = (
	line: ClassifiableLine,
	rules: ReadonlyArray<RevenueRule>,
	catalog: ReadonlyMap<string, CatalogPrice>,
): Classified => {
	const price = line.priceId === null ? undefined : catalog.get(line.priceId)
	for (const rule of rules) {
		if (rule.conditions.length > 0 && rule.conditions.every((condition) => holds(line, price, condition)))
			return { classification: rule.classification, ruleId: rule.id }
	}
	return { classification: defaultClassOf(line, price), ruleId: null }
}

/**
 * A short, stable fingerprint of the revenue basis (rules, window, reporting currency, and `version`
 * for a change of method): an account's MRR computed under another one is restated, not moved.
 */
export const revenueBasisOf = (
	rules: ReadonlyArray<RevenueRule>,
	variableMrrMonths: number,
	currency: string,
	version: number,
): string => {
	const text = JSON.stringify({
		version,
		currency,
		variableMrrMonths,
		rules: rules.map((rule) => [rule.conditions, rule.classification]),
	})
	// FNV-1a, 32 bits: a fingerprint, not a secret.
	let hash = 0x811c9dc5
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193)
	}
	return `v${version}:${(hash >>> 0).toString(16).padStart(8, "0")}`
}
