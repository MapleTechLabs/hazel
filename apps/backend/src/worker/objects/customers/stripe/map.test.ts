/**
 * The Stripe mapping: how a customer finds its account, and how a subscription's items, intervals,
 * quantities and coupons become one monthly amount in the currency's minor units.
 */
import type { ConnectionConfig } from "@hazel/domain/customers"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
	accountDeletedOp,
	accountOp,
	billingContactOp,
	clerkOrgIdsOf,
	customerOps,
	invoiceOp,
	monthlyMrrOf,
	primaryProductIdOf,
	statusOf,
	subscriptionOp,
} from "./map"
import {
	CUSTOMER_ACME,
	CUSTOMER_GLOBEX,
	CUSTOMER_PERSONAL,
	DISCOUNT_20_PERCENT,
	INVOICE_ACME_PAID,
	INVOICE_GLOBEX_OPEN,
	INVOICE_ACME_OLD_VERSION,
	ORG_ACME,
	ORG_GLOBEX,
	PAYMENT_METHOD_ACME,
	PRODUCT_PRO,
	PRODUCT_SEATS,
	SEC,
	SUB_ACME,
	SUB_GLOBEX,
	SUB_PERSONAL_CANCELED,
} from "./fixtures"
import { StripeCustomer, StripeInvoice, StripeSubscription } from "./wire"

const CONFIG: ConnectionConfig = {
	_tag: "stripe",
	clerkOrgMetadataKey: "clerk_org_id",
	matchByDomain: true,
	accountId: "",
}
const NO_DOMAINS: ConnectionConfig = { ...CONFIG, matchByDomain: false }

const customer = Schema.decodeUnknownSync(StripeCustomer)
const subscription = Schema.decodeUnknownSync(StripeSubscription)
const invoice = Schema.decodeUnknownSync(StripeInvoice)

/** A subscription of one item, for the amount table. */
const oneItem = (
	price: Record<string, unknown>,
	overrides: { readonly quantity?: number | null; readonly currency?: string } = {},
) =>
	subscription({
		id: "sub_table",
		customer: "cus_table",
		status: "active",
		currency: overrides.currency ?? "usd",
		cancel_at_period_end: false,
		items: { data: [{ quantity: overrides.quantity ?? 1, price }] },
	})

const monthly = (unit_amount: number | null, recurring: Record<string, unknown>) => ({
	unit_amount,
	currency: "usd",
	billing_scheme: "per_unit",
	product: PRODUCT_PRO.id,
	recurring,
})

describe("a Stripe customer's account", () => {
	it("takes the Clerk organization id from the configured metadata key", () => {
		expect(clerkOrgIdsOf(customer(CUSTOMER_GLOBEX), CONFIG)).toEqual([ORG_GLOBEX])
	})

	it("falls back to Autumn's `autumn_id` without the configured key, when it is a Clerk org id", () => {
		// Autumn writes the Autumn customer id (the Clerk org id) under its own key.
		expect(clerkOrgIdsOf(customer(CUSTOMER_ACME), CONFIG)).toEqual([ORG_ACME])
		// An Autumn id that is not a Clerk organization id names nothing.
		expect(
			clerkOrgIdsOf(customer({ ...CUSTOMER_ACME, metadata: { autumn_id: "acme-team" } }), CONFIG),
		).toEqual([])
	})

	it("prefers the configured key, and reads no other `org_…` value", () => {
		expect(
			clerkOrgIdsOf(
				customer({
					...CUSTOMER_ACME,
					metadata: { clerk_org_id: ORG_GLOBEX, autumn_id: ORG_ACME, tenant: "acme-eu" },
				}),
				CONFIG,
			),
		).toEqual([ORG_GLOBEX])
		// Another tool's `org_…` under a key nobody configured is not a shared id.
		expect(
			clerkOrgIdsOf(customer({ ...CUSTOMER_ACME, metadata: { crm_org: ORG_ACME } }), CONFIG),
		).toEqual([])
	})

	it("names no organization when the metadata holds none", () => {
		expect(clerkOrgIdsOf(customer(CUSTOMER_PERSONAL), CONFIG)).toEqual([])
	})

	it("is a shared-id match that never creates a customer on its own, nor teaches it a domain", () => {
		expect(accountOp(customer(CUSTOMER_ACME), CONFIG, "2026-11-10T12:00:00.000Z")).toEqual({
			_tag: "account",
			externalId: CUSTOMER_ACME.id,
			externalUrl: `https://dashboard.stripe.com/customers/${CUSTOMER_ACME.id}`,
			name: "Acme Analytics",
			sameAs: [{ provider: "clerk", externalId: ORG_ACME }],
			onNoMatch: "unmatched",
			createdAt: new Date(CUSTOMER_ACME.created * 1000).toISOString(),
			observedAt: "2026-11-10T12:00:00.000Z",
		})
	})

	it("links a test-mode customer to the test Dashboard, and leaves absent fields alone", () => {
		const op = accountOp(customer({ ...CUSTOMER_GLOBEX, livemode: false }), CONFIG)
		expect(op.externalUrl).toBe(`https://dashboard.stripe.com/test/customers/${CUSTOMER_GLOBEX.id}`)
		// No name, no email: nothing that would clear what Clerk established.
		expect(op).not.toHaveProperty("name")
		expect(op).not.toHaveProperty("domains")
		expect(op).not.toHaveProperty("matchByDomain")
	})

	it("offers the email's domain as a match key only without a shared id", () => {
		const noSharedId = customer({ ...CUSTOMER_ACME, metadata: {} })
		expect(accountOp(noSharedId, CONFIG)).toMatchObject({ domains: ["acme.com"], matchByDomain: true })
		// Nor when the connection does not match by domain.
		const op = accountOp(noSharedId, NO_DOMAINS)
		expect(op).not.toHaveProperty("domains")
		expect(op).not.toHaveProperty("matchByDomain")
	})

	it("offers a free-mail domain too, which ingest is the one to drop", () => {
		expect(accountOp(customer(CUSTOMER_PERSONAL), CONFIG).domains).toEqual(["gmail.com"])
	})

	it("writes the billing contact from the customer's email, and nothing without one", () => {
		expect(billingContactOp(customer(CUSTOMER_ACME), "2026-11-10T12:00:00.000Z")).toEqual({
			_tag: "contact",
			externalId: CUSTOMER_ACME.id,
			account: { provider: "stripe", externalId: CUSTOMER_ACME.id },
			externalUrl: `https://dashboard.stripe.com/customers/${CUSTOMER_ACME.id}`,
			email: "billing@acme.com",
			isBillingContact: true,
			observedAt: "2026-11-10T12:00:00.000Z",
		})
		expect(billingContactOp(customer(CUSTOMER_GLOBEX))).toBeNull()
		// The account comes first: ingest needs it before the contact names it.
		expect(customerOps(customer(CUSTOMER_ACME), CONFIG).map((op) => op._tag)).toEqual([
			"account",
			"contact",
		])
		expect(customerOps(customer(CUSTOMER_GLOBEX), CONFIG).map((op) => op._tag)).toEqual(["account"])
	})

	it("marks a deleted customer without reviving anything else about it", () => {
		expect(accountDeletedOp(CUSTOMER_ACME.id)).toEqual({
			_tag: "account",
			externalId: CUSTOMER_ACME.id,
			sameAs: [],
			onNoMatch: "unmatched",
			deleted: true,
		})
	})
})

describe("MRR, normalized to a month in minor units", () => {
	it("takes a monthly price as it is", () => {
		expect(
			monthlyMrrOf(oneItem(monthly(10_000, { interval: "month", interval_count: 1 }))).mrrMinor,
		).toBe(10_000)
	})

	it("divides a yearly price by twelve", () => {
		expect(
			monthlyMrrOf(oneItem(monthly(120_000, { interval: "year", interval_count: 1 }))).mrrMinor,
		).toBe(10_000)
	})

	it("divides by the interval count, and rounds once at the end", () => {
		// 90.00 every three months → 30.00 a month.
		expect(monthlyMrrOf(oneItem(monthly(9_000, { interval: "month", interval_count: 3 }))).mrrMinor).toBe(
			3_000,
		)
		// 10.00 every two years → 41.666… cents a month.
		expect(monthlyMrrOf(oneItem(monthly(1_000, { interval: "year", interval_count: 2 }))).mrrMinor).toBe(
			42,
		)
	})

	it("spreads a weekly or daily price over the year, and calls the interval `other`", () => {
		const weekly = oneItem(monthly(1_000, { interval: "week", interval_count: 1 }))
		expect(monthlyMrrOf(weekly).mrrMinor).toBe(Math.round((1_000 * 52) / 12))
		expect(subscriptionOp(weekly)?.interval).toBe("other")
		const daily = oneItem(monthly(100, { interval: "day", interval_count: 1 }))
		expect(monthlyMrrOf(daily).mrrMinor).toBe(Math.round((100 * 365) / 12))
	})

	it("multiplies by the quantity", () => {
		expect(
			monthlyMrrOf(oneItem(monthly(4_900, { interval: "month", interval_count: 1 }), { quantity: 3 }))
				.mrrMinor,
		).toBe(14_700)
		// No quantity on the item (a metered one, say) counts as one.
		expect(
			monthlyMrrOf(
				oneItem(monthly(4_900, { interval: "month", interval_count: 1 }), { quantity: null }),
			).mrrMinor,
		).toBe(4_900)
	})

	it("keeps a zero-decimal currency's amount untouched", () => {
		// ¥5,000 is `5000` in Stripe and `5000` minor in Hazel: nothing is divided by 100 anywhere.
		const yen = oneItem(
			{ ...monthly(5_000, { interval: "month", interval_count: 1 }), currency: "jpy" },
			{ currency: "jpy" },
		)
		expect(monthlyMrrOf(yen)).toMatchObject({ mrrMinor: 5_000, currency: "jpy" })
	})

	it("reads a sub-cent price off `unit_amount_decimal`", () => {
		const fractional = oneItem(
			{
				...monthly(null, { interval: "month", interval_count: 1 }),
				unit_amount_decimal: "0.4",
			},
			{ quantity: 1_000 },
		)
		expect(monthlyMrrOf(fractional).mrrMinor).toBe(400)
	})

	it("adds up every priced item and ignores the ones Stripe puts no amount on", () => {
		// Three seats at 49.00 EUR plus a metered, tiered price that states no amount.
		expect(monthlyMrrOf(subscription(SUB_GLOBEX))).toMatchObject({
			mrrMinor: 14_700,
			listMrrMinor: 14_700,
			currency: "eur",
			unpricedItems: 1,
		})
		const two = subscription({
			...SUB_GLOBEX,
			items: {
				data: [
					{ quantity: 2, price: monthly(10_000, { interval: "month", interval_count: 1 }) },
					{ quantity: 1, price: monthly(120_000, { interval: "year", interval_count: 1 }) },
				],
			},
		})
		expect(monthlyMrrOf(two).mrrMinor).toBe(20_000 + 10_000)
	})

	it("takes the plan, interval and quantity from the item that carries the amount", () => {
		const mixed = subscription({
			...SUB_GLOBEX,
			items: {
				data: [
					{
						quantity: 1,
						price: {
							...monthly(900, { interval: "month", interval_count: 1 }),
							product: PRODUCT_SEATS.id,
						},
					},
					{
						quantity: 4,
						price: {
							...monthly(120_000, { interval: "year", interval_count: 1 }),
							product: PRODUCT_PRO.id,
						},
					},
				],
			},
		})
		expect(primaryProductIdOf(mixed)).toBe(PRODUCT_PRO.id)
		expect(subscriptionOp(mixed, new Map([[PRODUCT_PRO.id, "Pro"]]))).toMatchObject({
			planName: "Pro",
			interval: "year",
			quantity: 4,
		})
	})

	it("falls back to the price's nickname only for a product Stripe did not return", () => {
		const nicknamed = oneItem({
			...monthly(10_000, { interval: "month", interval_count: 1 }),
			nickname: "Pro monthly",
		})
		expect(subscriptionOp(nicknamed, new Map())?.planName).toBe("Pro monthly")
		expect(
			subscriptionOp(oneItem(monthly(10_000, { interval: "month", interval_count: 1 })), new Map())
				?.planName,
		).toBe(null)
	})

	it("applies a percentage coupon, and keeps the undiscounted amount as the list price", () => {
		const discounted = subscription({
			...SUB_ACME,
			discounts: [DISCOUNT_20_PERCENT],
		})
		expect(monthlyMrrOf(discounted)).toMatchObject({ mrrMinor: 96_000, listMrrMinor: 120_000 })
	})

	it("applies a fixed coupon in the subscription's own currency, spread over its interval", () => {
		const amountOff = (currency: string | null) => ({
			...DISCOUNT_20_PERCENT,
			coupon: {
				id: "OFF120",
				percent_off: null,
				amount_off: 120_000,
				currency,
				duration: "forever",
			},
		})
		// 1 200.00 off a yearly subscription is 100.00 a month.
		expect(monthlyMrrOf(subscription({ ...SUB_ACME, discounts: [amountOff("usd")] })).mrrMinor).toBe(
			110_000,
		)
		// Another currency's coupon says nothing about this subscription's amount.
		expect(monthlyMrrOf(subscription({ ...SUB_ACME, discounts: [amountOff("eur")] })).mrrMinor).toBe(
			120_000,
		)
	})

	it("reads a coupon under `source` too, where 2025-09-30.clover moved it", () => {
		const clover = subscription({
			...SUB_ACME,
			discounts: [{ id: "di_clover", source: { coupon: { id: "HALF", percent_off: 50 } } }],
		})
		expect(monthlyMrrOf(clover).mrrMinor).toBe(60_000)
	})

	it("never goes below zero", () => {
		const overDiscounted = subscription({
			...SUB_ACME,
			discounts: [
				{
					id: "di_big",
					coupon: { id: "BIG", percent_off: null, amount_off: 999_999_999, currency: "usd" },
				},
			],
		})
		expect(monthlyMrrOf(overDiscounted).mrrMinor).toBe(0)
	})
})

describe("a Stripe subscription", () => {
	it("maps the state Hazel scores on", () => {
		expect(subscriptionOp(subscription(SUB_ACME), new Map([[PRODUCT_PRO.id, "Pro"]]))).toEqual({
			_tag: "subscription",
			externalId: SUB_ACME.id,
			account: { provider: "stripe", externalId: CUSTOMER_ACME.id },
			planName: "Pro",
			status: "active",
			mrrMinor: 120_000,
			listMrrMinor: 120_000,
			currency: "usd",
			interval: "year",
			quantity: 12,
			startedAt: new Date(SUB_ACME.start_date * 1000).toISOString(),
			trialEndsAt: null,
			// The period moved onto the items in 2025-03-31.basil.
			currentPeriodEnd: new Date(SEC("2026-12-01T09:20:00.000Z") * 1000).toISOString(),
			cancelAtPeriodEnd: false,
			canceledAt: null,
			cancellationReason: null,
		})
	})

	it("reads the period off the subscription when an older version keeps it there", () => {
		const legacy = subscription({
			...SUB_ACME,
			current_period_end: SEC("2027-01-14T09:25:00.000Z"),
			items: { data: [{ quantity: 1, price: monthly(10_000, { interval: "month" }) }] },
		})
		expect(subscriptionOp(legacy)?.currentPeriodEnd).toBe(
			new Date(SEC("2027-01-14T09:25:00.000Z") * 1000).toISOString(),
		)
	})

	it("keeps a trial's amount as its list price, which is what a trial is ranked by", () => {
		expect(subscriptionOp(subscription(SUB_GLOBEX))).toMatchObject({
			status: "trialing",
			mrrMinor: 14_700,
			listMrrMinor: 14_700,
			trialEndsAt: new Date(SUB_GLOBEX.trial_end * 1000).toISOString(),
		})
	})

	it("keeps a canceled subscription's amount, so compute can see the churn", () => {
		expect(subscriptionOp(subscription(SUB_PERSONAL_CANCELED))).toMatchObject({
			status: "canceled",
			mrrMinor: 10_000,
			canceledAt: new Date(SUB_PERSONAL_CANCELED.canceled_at * 1000).toISOString(),
			cancellationReason: "cancellation_requested",
		})
	})

	it("falls back to the customer's feedback when Stripe states no reason", () => {
		expect(
			subscriptionOp(
				subscription({
					...SUB_PERSONAL_CANCELED,
					cancellation_details: { reason: null, feedback: "too_expensive" },
				}),
			)?.cancellationReason,
		).toBe("too_expensive")
	})

	it("records the card when the payment method is expanded, and leaves it alone when it is an id", () => {
		const card = { brand: "visa", last4: "4242", expMonth: 4, expYear: 2030 }
		const expanded = subscription({ ...SUB_ACME, default_payment_method: PAYMENT_METHOD_ACME })
		expect(subscriptionOp(expanded)?.paymentMethod).toEqual(card)
		// An id that was not expanded says nothing: the stored card must not be cleared.
		expect(subscriptionOp(subscription(SUB_ACME))).not.toHaveProperty("paymentMethod")
		// None of its own: the customer's invoice default is what Stripe charges.
		const viaCustomer = (method: unknown) =>
			subscription({
				...SUB_ACME,
				default_payment_method: null,
				customer: { ...CUSTOMER_ACME, invoice_settings: { default_payment_method: method } },
			})
		expect(subscriptionOp(viaCustomer(PAYMENT_METHOD_ACME))?.paymentMethod).toEqual(card)
		// Neither has one (the card was detached): no card on file.
		expect(subscriptionOp(viaCustomer(null))?.paymentMethod).toBeNull()
		// A wallet or a bank debit has no card: its type is what there is to show.
		const sepa = subscription({
			...SUB_ACME,
			default_payment_method: { id: "pm_sepa", type: "sepa_debit", card: null },
		})
		expect(subscriptionOp(sepa)?.paymentMethod).toEqual({
			brand: "sepa_debit",
			last4: null,
			expMonth: null,
			expYear: null,
		})
	})

	it("counts a cancellation set for a date as scheduled", () => {
		expect(subscriptionOp(subscription(SUB_ACME))?.cancelAtPeriodEnd).toBe(false)
		expect(
			subscriptionOp(subscription({ ...SUB_ACME, cancel_at: SEC("2027-01-01T00:00:00.000Z") }))
				?.cancelAtPeriodEnd,
		).toBe(true)
	})

	it("skips a subscription whose first payment never went through, and where that one ends", () => {
		expect(statusOf("incomplete")).toBeNull()
		expect(subscriptionOp(subscription({ ...SUB_ACME, status: "incomplete" }))).toBeNull()
		// Never recorded while incomplete, so its expiry is no churn either.
		expect(statusOf("incomplete_expired")).toBeNull()
		expect(statusOf("paused")).toBe("paused")
		// A status Stripe adds later is skipped rather than guessed at.
		expect(statusOf("quantum")).toBeNull()
		expect(subscriptionOp(subscription({ ...SUB_ACME, customer: null }))).toBeNull()
	})
})

describe("a Stripe invoice", () => {
	it("maps the amounts, the dates and the hosted copy", () => {
		expect(invoiceOp(invoice(INVOICE_ACME_PAID))).toEqual({
			_tag: "invoice",
			externalId: INVOICE_ACME_PAID.id,
			account: { provider: "stripe", externalId: CUSTOMER_ACME.id },
			subscriptionExternalId: SUB_ACME.id,
			number: "HAZEL-0001",
			status: "paid",
			amountDueMinor: 120_000,
			amountPaidMinor: 120_000,
			currency: "usd",
			issuedAt: new Date(SEC("2026-11-01T09:26:00.000Z") * 1000).toISOString(),
			dueAt: null,
			paidAt: new Date(SEC("2026-11-01T09:27:00.000Z") * 1000).toISOString(),
			attemptCount: 1,
			nextRetryAt: null,
			hostedUrl: INVOICE_ACME_PAID.hosted_invoice_url,
		})
	})

	it("finds the subscription wherever this API version keeps it", () => {
		expect(invoiceOp(invoice(INVOICE_ACME_OLD_VERSION))?.subscriptionExternalId).toBe(SUB_ACME.id)
		expect(
			invoiceOp(invoice({ ...INVOICE_ACME_OLD_VERSION, subscription: null }))?.subscriptionExternalId,
		).toBe(null)
	})

	it("carries the overdue date and the next attempt of an open invoice", () => {
		expect(invoiceOp(invoice(INVOICE_GLOBEX_OPEN))).toMatchObject({
			status: "open",
			amountDueMinor: 14_700,
			amountPaidMinor: 0,
			dueAt: new Date(INVOICE_GLOBEX_OPEN.due_date * 1000).toISOString(),
			nextRetryAt: new Date(INVOICE_GLOBEX_OPEN.next_payment_attempt * 1000).toISOString(),
		})
	})

	it("states a reason on a failed payment, so the first attempt reaches the timeline", () => {
		// Ingest raises `invoice.payment_failed` for an open invoice with a reason or a retry.
		expect(invoiceOp(invoice(INVOICE_GLOBEX_OPEN), { paymentFailed: true })?.declineReason).toBe(
			"Stripe could not collect this payment",
		)
		// Anything else leaves the stored reason alone: no other field of an invoice is a decline.
		expect(invoiceOp(invoice(INVOICE_GLOBEX_OPEN))).not.toHaveProperty("declineReason")
		// Nor does a failure event about an invoice paid since.
		expect(invoiceOp(invoice(INVOICE_ACME_PAID), { paymentFailed: true })).not.toHaveProperty(
			"declineReason",
		)
	})

	it("skips a preview, a draft, a customerless invoice and a status Hazel does not record", () => {
		expect(invoiceOp(invoice({ ...INVOICE_ACME_PAID, id: null }))).toBeNull()
		expect(invoiceOp(invoice({ ...INVOICE_ACME_PAID, status: "draft" }))).toBeNull()
		expect(invoiceOp(invoice({ ...INVOICE_ACME_PAID, customer: null }))).toBeNull()
		expect(invoiceOp(invoice({ ...INVOICE_ACME_PAID, status: "deleted" }))).toBeNull()
	})

	it("never hands the store a negative amount", () => {
		expect(
			invoiceOp(invoice({ ...INVOICE_ACME_PAID, amount_due: -5_000, amount_paid: -1 })),
		).toMatchObject({ amountDueMinor: 0, amountPaidMinor: 0 })
	})
})
