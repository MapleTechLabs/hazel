/**
 * The revenue settings' reads (`docs/customers/revenue.md`): the price catalog the rules editor names
 * prices and products from, and a dry run of draft rules: the org's MRR and variable MRR under the
 * saved rules and the draft, and how each price's lines classify under both. Nothing is written.
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	type ClassifiableLine,
	classifyLine,
	type RevenueCatalog,
	type RevenuePreviewGroup,
	type RevenuePreviewResult,
	type RevenueRule,
} from "@hazel/domain/customers"
import type { CustomerAccountId } from "@hazel/schema"
import { Effect } from "effect"
import {
	accountRevenueOf,
	type BilledInvoice,
	invoiceLine,
	itemLine,
	loadCatalog,
	makeRevenueBasis,
	type RevenueBasis,
	USAGE_LOOKBACK_MS,
	windowMonths,
} from "./revenue"
import { accountChunks, billingByAccount, loadBase } from "./snapshot"
import { inList } from "./sql"
import { DAY_MS } from "./time"

/** How far back the preview lists invoice lines. */
const PREVIEW_DAYS = 90
/** Groups the preview returns, most billed first. */
const MAX_GROUPS = 200

export const revenueCatalog = Effect.fn("Customers.revenueCatalog")(function* (now: Date) {
	const db = yield* Database.Database
	const { prices } = yield* loadCatalog
	const recent = yield* db.run(
		SQLite.from(schema.customerInvoicesTable)
			.select("lines")
			.where(($) => [
				$.issuedAt.gte(new Date(now.getTime() - PREVIEW_DAYS * DAY_MS)),
				$.lines.isNotNull(),
			]),
	)
	const keys = new Set<string>()
	for (const price of prices) {
		for (const key of Object.keys(price.metadata)) keys.add(key)
		for (const key of Object.keys(price.productMetadata)) keys.add(key)
	}
	for (const invoice of recent)
		for (const line of invoice.lines ?? []) for (const key of Object.keys(line.metadata)) keys.add(key)
	return {
		prices: prices
			.map((price) => ({
				priceId: price.externalId,
				productId: price.productId,
				productName: price.productName,
				nickname: price.nickname,
				lookupKey: price.lookupKey,
				priceType: price.priceType,
				usageType: price.usageType,
				billingScheme: price.billingScheme,
				currency: price.currency,
				unitAmountMinor: price.unitAmountMinor,
				interval: price.interval,
				active: price.active,
			}))
			.sort(
				(a, b) =>
					(a.productName ?? "").localeCompare(b.productName ?? "") ||
					a.priceId.localeCompare(b.priceId),
			),
		metadataKeys: [...keys].sort(),
	} satisfies RevenueCatalog
})

const groupKey = (line: ClassifiableLine, description: string | null) =>
	line.priceId === null
		? `none:${line.source}:${line.proration}:${description ?? ""}`
		: `${line.priceId}:${line.source}:${line.proration}`

export const revenuePreview = Effect.fn("Customers.revenuePreview")(function* (
	draft: { readonly rules: ReadonlyArray<RevenueRule>; readonly variableMrrMonths: number },
	now: Date,
) {
	const db = yield* Database.Database
	// As compute sees the org: its live accounts, settings and each account's billing source.
	const base = yield* loadBase(now)
	const { currency } = base.org
	const { prices, items } = yield* loadCatalog
	const saved = makeRevenueBasis(
		base.settings.revenueRules,
		base.settings.variableMrrMonths,
		currency,
		prices,
		items,
	)
	const proposed = makeRevenueBasis(draft.rules, draft.variableMrrMonths, currency, prices, items)
	const catalog = new Map(prices.map((price) => [price.externalId, price]))

	// Totals: every live account, as compute counts it (`accountRevenueOf`), under both bases.
	const accounts = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "mrrSource")
			.where(($) => [$.deletedAt.isNull()]),
	)
	const subscriptions = yield* db.run(
		SQLite.from(schema.customerSubscriptionsTable)
			.select()
			.where(($) => [inList($.provider, ["stripe", "autumn"])]),
	)
	const billingBy = billingByAccount(
		base.autumnReady,
		subscriptions,
		new Map(accounts.map((account) => [account.id, account.mrrSource])),
	)
	const longest = Math.max(saved.months, proposed.months)
	const invoicesFrom = new Date(windowMonths(now, longest)[0] - USAGE_LOOKBACK_MS)
	const totals = (basis: RevenueBasis) => ({ mrrMinor: 0, variableMrrMinor: 0, basis })
	const current = totals(saved)
	const next = totals(proposed)
	for (const chunk of accountChunks(accounts)) {
		const invoices = yield* db.run(
			SQLite.from(schema.customerInvoicesTable)
				.select(
					"accountId",
					"status",
					"currency",
					"issuedAt",
					"paidAt",
					"amountPaidMinor",
					"servicePeriodStart",
					"lines",
				)
				.where(($) => [
					inList(
						$.accountId,
						chunk.map((account) => account.id),
					),
					$.status.in_("open", "paid"),
					$.currency.eq(currency),
					$.issuedAt.gte(invoicesFrom),
				]),
		)
		const invoicesBy = new Map<CustomerAccountId, Array<BilledInvoice>>()
		for (const invoice of invoices)
			invoicesBy.set(invoice.accountId, [...(invoicesBy.get(invoice.accountId) ?? []), invoice])
		for (const account of chunk) {
			for (const total of [current, next]) {
				const result = accountRevenueOf({
					subscriptions: billingBy.get(account.id)?.subscriptions ?? [],
					invoices: invoicesBy.get(account.id) ?? [],
					basis: total.basis,
					currency,
					now,
				})
				total.mrrMinor += result.mrrMinor
				total.variableMrrMinor += result.variableMrrMinor
			}
		}
	}

	// Groups: the last 90 days' invoice lines, and live subscriptions' items, by price.
	const groups = new Map<string, RevenuePreviewGroup>()
	const groupOf = (line: ClassifiableLine, description: string | null) => {
		// Same price, different metadata: rules may class such lines apart, so they group apart.
		const before = classifyLine(line, saved.rules, saved.catalog)
		const after = classifyLine(line, proposed.rules, proposed.catalog)
		const key = [
			groupKey(line, description),
			before.classification,
			before.ruleId,
			after.classification,
			after.ruleId,
		].join(":")
		const existing = groups.get(key)
		if (existing !== undefined) return existing
		const price = line.priceId === null ? undefined : catalog.get(line.priceId)
		const priceLabel = price?.nickname ?? price?.lookupKey ?? null
		const group: RevenuePreviewGroup = {
			priceId: line.priceId,
			productId: line.productId ?? price?.productId ?? null,
			label: price?.productName ?? priceLabel ?? description ?? line.priceId ?? "Invoice item",
			detail: price?.productName != null ? priceLabel : null,
			source: line.source,
			proration: line.proration,
			usageType: price?.usageType ?? line.usageType ?? null,
			billingScheme: price?.billingScheme ?? line.billingScheme ?? null,
			lineCount: 0,
			amountMinor: 0,
			itemCount: 0,
			monthlyMinor: 0,
			current: before,
			proposed: after,
		}
		groups.set(key, group)
		return group
	}
	const recent = yield* db.run(
		SQLite.from(schema.customerInvoicesTable)
			.select("lines")
			.where(($) => [
				$.status.in_("open", "paid"),
				$.currency.eq(currency),
				$.issuedAt.gte(new Date(now.getTime() - PREVIEW_DAYS * DAY_MS)),
				$.lines.isNotNull(),
			]),
	)
	for (const invoice of recent) {
		for (const line of invoice.lines ?? []) {
			const group = groupOf(invoiceLine(line), line.description) as {
				lineCount: number
				amountMinor: number
			}
			group.lineCount++
			group.amountMinor += line.amountMinor
		}
	}
	for (const sub of subscriptions) {
		if (sub.status === "canceled" || sub.currency !== currency) continue
		for (const item of sub.items ?? []) {
			const group = groupOf(itemLine(item), null) as { itemCount: number; monthlyMinor: number }
			group.itemCount++
			group.monthlyMinor += item.monthlyMinor ?? 0
		}
	}
	return {
		currency,
		current: { mrrMinor: current.mrrMinor, variableMrrMinor: current.variableMrrMinor },
		proposed: { mrrMinor: next.mrrMinor, variableMrrMinor: next.variableMrrMinor },
		groups: [...groups.values()]
			.sort(
				(a, b) =>
					Math.abs(b.amountMinor) + b.monthlyMinor - (Math.abs(a.amountMinor) + a.monthlyMinor),
			)
			.slice(0, MAX_GROUPS),
	} satisfies RevenuePreviewResult
})
