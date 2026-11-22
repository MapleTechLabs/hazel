/**
 * MRR, variable MRR and revenue from classified billing lines (`docs/customers/revenue.md`). Pure
 * but for {@link loadRevenueBasis}: compute, the history rebuild and the reads all go through here,
 * so a number is computed one way.
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	type CatalogPrice,
	DEFAULT_VARIABLE_MRR_MONTHS,
	type ClassifiableLine,
	type Classified,
	classifyLine,
	type InvoiceLineDoc,
	isUsagePriced,
	type RevenueClass,
	type RevenueRule,
	revenueBasisOf,
	type SubscriptionItemDoc,
} from "@hazel/domain/customers"
import { Effect, Option } from "effect"
import { billed, pays } from "./facts"
import { DAY_MS } from "./time"

/**
 * The method's version, part of the basis: bumping it restates every org's MRR history under the new
 * method on its next compute (`./compute.ts`).
 */
export const REVENUE_METHOD_VERSION = 1

/** What classification needs: the org's rules and window, the price catalog, and their fingerprint. */
export interface RevenueBasis {
	readonly rules: ReadonlyArray<RevenueRule>
	readonly months: number
	readonly catalog: ReadonlyMap<string, CatalogPrice>
	/** `revenueBasisOf(rules, months, REVENUE_METHOD_VERSION)`: an account's `mrrBasis`. */
	readonly key: string
}

export const catalogPriceOf = (row: schema.CustomerPrice): CatalogPrice => ({
	priceId: row.externalId,
	productId: row.productId,
	lookupKey: row.lookupKey,
	usageType: row.usageType,
	billingScheme: row.billingScheme,
	priceType: row.priceType,
	metadata: row.metadata,
	productMetadata: row.productMetadata,
})

/** A price only a subscription item tells of (its expanded price): its product's metadata unknown. */
const itemPriceOf = (item: SubscriptionItemDoc, priceId: string): CatalogPrice => ({
	priceId,
	productId: item.productId,
	lookupKey: item.lookupKey,
	usageType: item.usageType,
	billingScheme: item.billingScheme,
	priceType: "recurring",
	metadata: item.metadata,
	productMetadata: {},
})

/**
 * `prices` (the catalog), and `items`' prices it does not hold: an invoice line names only its price,
 * so a price the catalog has not caught up with (no price event received) is still known by usage.
 */
export const makeRevenueBasis = (
	rules: ReadonlyArray<RevenueRule>,
	months: number,
	currency: string,
	prices: ReadonlyArray<schema.CustomerPrice>,
	items: ReadonlyArray<SubscriptionItemDoc> = [],
): RevenueBasis => {
	const catalog = new Map(prices.map((row) => [row.externalId, catalogPriceOf(row)]))
	for (const item of items) {
		if (item.priceId !== null && !catalog.has(item.priceId))
			catalog.set(item.priceId, itemPriceOf(item, item.priceId))
	}
	return { rules, months, catalog, key: revenueBasisOf(rules, months, currency, REVENUE_METHOD_VERSION) }
}

/** The org's catalog, and the subscription items that name prices (`makeRevenueBasis`). */
export const loadCatalog = Effect.gen(function* () {
	const db = yield* Database.Database
	const prices = yield* db.run(SQLite.from(schema.customerPricesTable).select())
	const subscriptions = yield* db.run(
		SQLite.from(schema.customerSubscriptionsTable)
			.select("items")
			.where(($) => [$.items.isNotNull()]),
	)
	return { prices, items: subscriptions.flatMap((sub) => sub.items ?? []) }
})

/** The org's rules, window and reporting currency (defaults without a settings row), and the catalog. */
export const loadRevenueBasis = Effect.gen(function* () {
	const db = yield* Database.Database
	const settings = yield* db.first(
		SQLite.from(schema.customerSettingsTable)
			.select("revenueRules", "variableMrrMonths", "reportingCurrency")
			.limit(1),
	)
	const catalog = yield* loadCatalog
	return makeRevenueBasis(
		Option.match(settings, { onNone: () => [], onSome: (row) => row.revenueRules }),
		Option.match(settings, {
			onNone: () => DEFAULT_VARIABLE_MRR_MONTHS,
			onSome: (row) => row.variableMrrMonths,
		}),
		Option.match(settings, { onNone: () => "usd", onSome: (row) => row.reportingCurrency }),
		catalog.prices,
		catalog.items,
	)
})

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export const itemLine = (item: SubscriptionItemDoc): ClassifiableLine => ({
	source: "subscription",
	proration: false,
	priceId: item.priceId,
	productId: item.productId,
	metadata: item.metadata,
	lookupKey: item.lookupKey,
	usageType: item.usageType,
	billingScheme: item.billingScheme,
	priceType: "recurring",
})

export const invoiceLine = (line: InvoiceLineDoc): ClassifiableLine => ({
	source: line.source,
	proration: line.proration,
	priceId: line.priceId,
	productId: line.productId,
	metadata: line.metadata,
})

export const classifyItem = (item: SubscriptionItemDoc, basis: RevenueBasis): Classified =>
	classifyLine(itemLine(item), basis.rules, basis.catalog)

export const classifyInvoiceLine = (line: InvoiceLineDoc, basis: RevenueBasis): Classified =>
	classifyLine(invoiceLine(line), basis.rules, basis.catalog)

const priceOf = (line: ClassifiableLine, basis: RevenueBasis) =>
	line.priceId === null ? undefined : basis.catalog.get(line.priceId)

// ---------------------------------------------------------------------------
// MRR
// ---------------------------------------------------------------------------

/**
 * A subscription's contracted MRR: the monthly amounts of its items classed `recurring` with a fixed
 * price. One with no items stored (Autumn's; Stripe's read before items were) counts its `mrrMinor`.
 */
export const recurringMrrOf = (
	sub: Pick<schema.CustomerSubscription, "items" | "mrrMinor">,
	basis: RevenueBasis,
): number =>
	sub.items === null
		? sub.mrrMinor
		: sub.items.reduce(
				(sum, item) =>
					item.monthlyMinor !== null && classifyItem(item, basis).classification === "recurring"
						? sum + item.monthlyMinor
						: sum,
				0,
			)

/** An invoice as a subscription's MRR history reads it. */
export type SubscriptionInvoice = BilledInvoice & Pick<schema.CustomerInvoice, "subscriptionId">

const DAYS_PER_MONTH = 365.25 / 12

/** Months a line's service period covers: whole for a month or more, so a monthly line is its amount. */
const monthsOfPeriod = (start: number, end: number) => {
	const months = (end - start) / DAY_MS / DAYS_PER_MONTH
	return months >= 0.9 ? Math.max(1, Math.round(months)) : months
}

/**
 * A subscription's contracted MRR on each day, from what its invoices billed: the monthly amount of
 * its fixed-price recurring lines in effect at the end of that day (prorations aside), so an upgrade
 * shows on the renewal that billed it. Before its first such line, that line's amount; after its
 * last, and on the last day, its MRR now (`recurringMrrOf`). Without lines, its MRR now throughout.
 */
export const recurringHistoryOf = (
	sub: Pick<schema.CustomerSubscription, "id" | "items" | "mrrMinor" | "currency">,
	invoices: ReadonlyArray<SubscriptionInvoice>,
	basis: RevenueBasis,
	days: ReadonlyArray<string>,
): Array<number> => {
	const current = recurringMrrOf(sub, basis)
	const periods = invoices.flatMap((invoice) => {
		if (invoice.subscriptionId !== sub.id || !isBilled(invoice) || invoice.currency !== sub.currency)
			return []
		return (invoice.lines ?? []).flatMap((line) => {
			if (line.source !== "subscription" || line.proration) return []
			if (line.periodStart === null || line.periodEnd === null) return []
			const classifiable = invoiceLine(line)
			if (classifyLine(classifiable, basis.rules, basis.catalog).classification !== "recurring")
				return []
			if (isUsagePriced(classifiable, priceOf(classifiable, basis))) return []
			const start = Date.parse(line.periodStart)
			const end = Date.parse(line.periodEnd)
			return end <= start
				? []
				: [{ start, end, monthly: line.amountMinor / monthsOfPeriod(start, end) }]
		})
	})
	if (periods.length === 0) return days.map(() => current)
	const firstStart = Math.min(...periods.map((period) => period.start))
	const lastEnd = Math.max(...periods.map((period) => period.end))
	const inEffect = (at: number) => periods.filter((period) => period.start <= at && at < period.end)
	const first = Math.round(inEffect(firstStart).reduce((sum, period) => sum + period.monthly, 0))
	let carried = first
	return days.map((day, index) => {
		if (index === days.length - 1) return current
		const at = Date.parse(`${day}T00:00:00.000Z`) + DAY_MS - 1
		if (at < firstStart) return first
		if (at >= lastEnd) return current
		const active = inEffect(at)
		// A gap between two periods keeps the amount billed before it.
		if (active.length > 0)
			carried = Math.max(0, Math.round(active.reduce((sum, period) => sum + period.monthly, 0)))
		return carried
	})
}

// ---------------------------------------------------------------------------
// Trailing averages
// ---------------------------------------------------------------------------

/** An invoice as the averages and revenue read it. */
export type BilledInvoice = Pick<
	schema.CustomerInvoice,
	"status" | "currency" | "issuedAt" | "paidAt" | "amountPaidMinor" | "servicePeriodStart" | "lines"
>

/** Billed: finalized and still owed or paid. Void and uncollectible invoices are not revenue. */
export const isBilled = (invoice: Pick<schema.CustomerInvoice, "status">) =>
	invoice.status === "open" || invoice.status === "paid"

const monthStart = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
const addMonths = (ms: number, months: number) => {
	const date = new Date(ms)
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)
}

/** The window's months: the `months` full calendar months before `asOf`'s, oldest first (UTC). */
export const windowMonths = (asOf: Date, months: number): Array<number> => {
	const current = monthStart(asOf)
	return Array.from({ length: months }, (_, index) => addMonths(current, index - months))
}

export interface TrailingUsage {
	/** Lines classed `variable`, per month. */
	readonly variableMinor: number
	/** Lines classed `recurring` on a usage price (metered or tiered): MRR with no fixed amount. */
	readonly recurringUsageMinor: number
	/** Any line of the account's billed in the window's last month: an invoice-only customer is current. */
	readonly billedLastMonth: boolean
}

const NO_USAGE: TrailingUsage = { variableMinor: 0, recurringUsageMinor: 0, billedLastMonth: false }

/** `amount` spread over `[start, end)` by time; the share inside `[from, to)`. A point lands whole. */
const shareIn = (amount: number, start: number, end: number, from: number, to: number) => {
	if (end <= start) return start >= from && start < to ? amount : 0
	const overlap = Math.min(end, to) - Math.max(start, from)
	return overlap <= 0 ? 0 : (amount * overlap) / (end - start)
}

/**
 * The trailing monthly averages of one account's usage billing as of `asOf`, in `currency`
 * (`docs/customers/revenue.md`, Variable MRR): its billed invoices issued by `asOf`, each line spread
 * over its service period, summed over the window's months and divided by the months of it the
 * account has been billed in (from the month its first service period starts).
 */
export const trailingUsageOf = (
	invoices: ReadonlyArray<BilledInvoice>,
	basis: RevenueBasis,
	currency: string,
	asOf: Date,
): TrailingUsage => {
	const months = windowMonths(asOf, basis.months)
	const from = months[0]
	const to = monthStart(asOf)
	const lastMonth = months[months.length - 1]
	const billed = invoices.filter(
		(invoice) =>
			isBilled(invoice) &&
			invoice.currency === currency &&
			invoice.issuedAt !== null &&
			invoice.issuedAt <= asOf,
	)
	const firsts = billed.flatMap((invoice) => {
		const first = invoice.servicePeriodStart ?? invoice.issuedAt
		return first === null ? [] : [first.getTime()]
	})
	if (firsts.length === 0) return NO_USAGE
	const firstMonth = monthStart(new Date(Math.min(...firsts)))
	const counted = months.filter((month) => month >= firstMonth).length
	if (counted === 0) return NO_USAGE
	let variable = 0
	let recurringUsage = 0
	let billedLastMonth = false
	for (const invoice of billed) {
		for (const line of invoice.lines ?? []) {
			const fallback = invoice.issuedAt?.getTime() ?? 0
			const start = line.periodStart === null ? fallback : Date.parse(line.periodStart)
			const end = line.periodEnd === null ? start : Date.parse(line.periodEnd)
			if (shareIn(1, start, end, lastMonth, to) > 0) billedLastMonth = true
			const classifiable = invoiceLine(line)
			const { classification } = classifyLine(classifiable, basis.rules, basis.catalog)
			const usage =
				classification === "variable" ||
				(classification === "recurring" && isUsagePriced(classifiable, priceOf(classifiable, basis)))
			if (!usage) continue
			const share = shareIn(line.amountMinor, start, end, from, to)
			if (classification === "variable") variable += share
			else recurringUsage += share
		}
	}
	return {
		// A window of net credits is no negative run-rate.
		variableMinor: Math.max(0, Math.round(variable / counted)),
		recurringUsageMinor: Math.max(0, Math.round(recurringUsage / counted)),
		billedLastMonth,
	}
}

/**
 * One account's MRR and variable MRR now (`docs/customers/revenue.md`), from its billing source's
 * subscriptions (`billingProviderOf`) and its billed invoices: the recurring items of its live,
 * billed subscriptions in `currency`, plus recurring usage while a subscription bills it; variable
 * MRR while it is billed, by a subscription, or (with none at all) last month.
 */
export const accountRevenueOf = (input: {
	readonly subscriptions: ReadonlyArray<schema.CustomerSubscription>
	readonly invoices: ReadonlyArray<BilledInvoice>
	readonly basis: RevenueBasis
	readonly currency: string
	readonly now: Date
}): { readonly mrrMinor: number; readonly variableMrrMinor: number } => {
	const { subscriptions, basis, currency } = input
	const paying = subscriptions.filter((sub) => sub.status !== "canceled" && billed(sub))
	const paid = paying.some(pays)
	const usage = trailingUsageOf(input.invoices, basis, currency, input.now)
	const current = paid || (subscriptions.length === 0 && usage.billedLastMonth)
	return {
		mrrMinor:
			paying
				.filter((sub) => sub.currency === currency)
				.reduce((sum, sub) => sum + recurringMrrOf(sub, basis), 0) +
			(paid ? usage.recurringUsageMinor : 0),
		variableMrrMinor: current ? usage.variableMinor : 0,
	}
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

export interface RevenueSplit {
	recurring: number
	variable: number
	oneOff: number
	/** Paid on an invoice Hazel holds no lines for (read before lines were stored, Autumn's). */
	unclassified: number
}

export const emptySplit = (): RevenueSplit => ({ recurring: 0, variable: 0, oneOff: 0, unclassified: 0 })

const SPLIT_KEY = {
	recurring: "recurring",
	variable: "variable",
	one_off: "oneOff",
	excluded: null,
} as const satisfies Record<RevenueClass, keyof RevenueSplit | null>

/** Adds one paid invoice to `split`: its lines' net amounts (tax out) by class, excluded ones left out. */
export const addRevenue = (split: RevenueSplit, invoice: BilledInvoice, basis: RevenueBasis) => {
	if (invoice.lines === null || invoice.lines.length === 0) {
		split.unclassified += invoice.amountPaidMinor
		return
	}
	for (const line of invoice.lines) {
		const key = SPLIT_KEY[classifyInvoiceLine(line, basis).classification]
		if (key !== null) split[key] += line.amountMinor
	}
}

export const totalOf = (split: RevenueSplit) =>
	split.recurring + split.variable + split.oneOff + split.unclassified
