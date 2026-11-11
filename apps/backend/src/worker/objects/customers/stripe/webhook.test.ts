/**
 * Stripe webhook deliveries: the signature check with the connection's endpoint secret, the account
 * and mode checks, then each subscribed event type's ops over the recorded payloads. Deliveries are
 * signed here exactly as Stripe signs them, so the verification path is the real one.
 */
import type { ConnectionConfig, IngestOp, UpsertAccount, UpsertSubscription } from "@hazel/domain/customers"
import { Effect, Redacted } from "effect"
import { HttpClient } from "effect/http"
import { describe, expect, it } from "vitest"
import {
	ACCOUNT,
	CUSTOMER_ACME,
	CUSTOMER_GLOBEX,
	DISCOUNT_20_PERCENT,
	event,
	INVOICE_GLOBEX_OPEN,
	ORG_ACME,
	PAYMENT_METHOD_ACME,
	PRODUCT_PRO,
	PRODUCT_SEATS,
	SUB_ACME,
	SUB_GLOBEX,
} from "./fixtures"
import { makeStripeGet } from "./http"
import { signStripe } from "./signature"
import { type FakeStripeState, fakeStripeHttpClient, makeFakeStripe } from "./testing"
import { receiveWebhook } from "./webhook"

const SECRET = "whsec_hazeltest00000000000000000000"
const API_KEY = "rk_test_fake000000000000000000"
const CONFIG: ConnectionConfig = {
	_tag: "stripe",
	clerkOrgMetadataKey: "clerk_org_id",
	matchByDomain: true,
	accountId: "",
}

const stripe = () =>
	makeFakeStripe({
		apiKey: API_KEY,
		account: ACCOUNT,
		products: [PRODUCT_PRO, PRODUCT_SEATS],
		customers: [CUSTOMER_ACME, CUSTOMER_GLOBEX],
		subscriptions: [SUB_ACME, SUB_GLOBEX],
		paymentMethods: [PAYMENT_METHOD_ACME],
	})

/** Stripe signs each attempt as of now, and refuses one signed more than five minutes ago. */
const nowMs = () => Date.now()

const deliver = (
	body: string,
	options: {
		readonly secret?: string
		readonly tamper?: boolean
		readonly timestampMs?: number
		readonly header?: string
		readonly accountId?: string | null
		readonly livemode?: boolean | null
		readonly config?: ConnectionConfig
		readonly fake?: FakeStripeState
	} = {},
) =>
	Effect.gen(function* () {
		const timestamp = String(Math.floor((options.timestampMs ?? nowMs()) / 1000))
		const signature = yield* signStripe(SECRET, timestamp, body)
		const get = makeStripeGet(yield* HttpClient.HttpClient, Redacted.make(API_KEY))
		return yield* receiveWebhook({
			get,
			headers: { "stripe-signature": options.header ?? `t=${timestamp},v1=${signature}` },
			body: options.tamper === true ? `${body} ` : body,
			webhookSecret: Redacted.make(options.secret ?? SECRET),
			accountId: options.accountId === undefined ? ACCOUNT.id : options.accountId,
			livemode: options.livemode === undefined ? true : options.livemode,
			config: options.config ?? CONFIG,
		})
	}).pipe(Effect.provide(fakeStripeHttpClient(options.fake ?? stripe())))

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
const tags = (ops: ReadonlyArray<IngestOp>) => ops.map((op) => op._tag)

describe("Stripe webhook verification", () => {
	it("accepts a delivery Stripe signed", async () => {
		const ops = await run(deliver(event("customer.updated", CUSTOMER_GLOBEX)))
		expect(tags(ops)).toEqual(["account"])
	})

	it("refuses a tampered body, a wrong secret and a replay", async () => {
		const body = event("customer.updated", CUSTOMER_GLOBEX)
		expect((await run(Effect.flip(deliver(body, { tamper: true })))).message).toMatch(/signature/i)
		expect(
			(await run(Effect.flip(deliver(body, { secret: "whsec_other000000000000000" })))).message,
		).toMatch(/signature/i)
		expect(
			(await run(Effect.flip(deliver(body, { timestampMs: nowMs() - 10 * 60_000 })))).message,
		).toMatch(/replay window/i)
	})

	it("refuses a delivery with no signature header of its own", async () => {
		expect(
			(await run(Effect.flip(deliver(event("customer.updated", CUSTOMER_GLOBEX), { header: "" }))))
				.message,
		).toMatch(/missing its Stripe-Signature/i)
	})

	it("refuses a body that is not JSON, and one that is not a Stripe event", async () => {
		expect((await run(Effect.flip(deliver("not json")))).message).toMatch(/not a Stripe event/i)
		expect(await run(Effect.flip(deliver(JSON.stringify({ hello: "world" }))))).toMatchObject({
			message: expect.stringMatching(/not a Stripe event/i),
		})
	})

	it("refuses an event from another connected Stripe account than the key opens", async () => {
		const body = event("customer.updated", CUSTOMER_GLOBEX, { account: "acct_1Other0000000000" })
		expect((await run(Effect.flip(deliver(body)))).message).toMatch(/another Stripe account/i)
		// Refused with no account to compare against too: a stamp is only ever another account's.
		expect((await run(Effect.flip(deliver(body, { accountId: null })))).message).toMatch(
			/another Stripe account/i,
		)
		// The connection's own account's stamp is accepted.
		const own = event("customer.updated", CUSTOMER_GLOBEX, { account: ACCOUNT.id })
		expect(tags(await run(deliver(own)))).toEqual(["account"])
		// The account's own events carry no `account` at all.
		expect(tags(await run(deliver(event("customer.updated", CUSTOMER_GLOBEX))))).toEqual(["account"])
	})

	it("refuses a test-mode event on a live key, and a live one on a test key", async () => {
		const test = event("customer.updated", CUSTOMER_GLOBEX, { livemode: false })
		expect((await run(Effect.flip(deliver(test, { livemode: true })))).message).toMatch(
			/test mode.*live one/i,
		)
		const live = event("customer.updated", CUSTOMER_GLOBEX, { livemode: true })
		expect((await run(Effect.flip(deliver(live, { livemode: false })))).message).toMatch(
			/live mode.*test one/i,
		)
		// A key whose prefix does not say which mode it is for cannot check.
		expect(tags(await run(deliver(test, { livemode: null })))).toEqual(["account"])
	})

	it("refuses a subscribed event whose payload is malformed, rather than retrying it forever", async () => {
		const error = await run(Effect.flip(deliver(event("customer.updated", { name: "No id here" }))))
		expect(error.message).toMatch(/not the shape Stripe documents/i)
	})
})

describe("Stripe webhook events", () => {
	const paths = (fake: FakeStripeState) => fake.calls.map((call) => call.path)

	it("customer.created writes the account and its billing contact, as Stripe has it now", async () => {
		const fake = stripe()
		const before = new Date().toISOString()
		const ops = await run(deliver(event("customer.created", CUSTOMER_ACME), { fake }))
		expect(tags(ops)).toEqual(["account", "contact"])
		const account = ops[0] as UpsertAccount
		expect(account.sameAs).toEqual([{ provider: "clerk", externalId: ORG_ACME }])
		// Observed when it was read, not when the event happened: the read is the current state.
		expect(account.observedAt! >= before).toBe(true)
		expect(paths(fake)).toEqual([`/customers/${CUSTOMER_ACME.id}`])
	})

	it("a deleted customer is a deletion, whichever customer event arrives late", async () => {
		const fake = stripe()
		const gone = makeFakeStripe({
			...fake,
			customers: [{ id: CUSTOMER_ACME.id, object: "customer", deleted: true }],
		})
		for (const type of ["customer.deleted", "customer.updated"]) {
			const ops = await run(deliver(event(type, CUSTOMER_ACME), { fake: gone }))
			expect(ops).toEqual([
				{
					_tag: "account",
					externalId: CUSTOMER_ACME.id,
					sameAs: [],
					onNoMatch: "unmatched",
					deleted: true,
					observedAt: expect.any(String),
				},
			])
		}
	})

	it("skips an object the key cannot see: another account's event, whatever its stamp", async () => {
		const stranger = { ...CUSTOMER_ACME, id: "cus_2stranger00001" }
		expect(await run(deliver(event("customer.updated", stranger)))).toEqual([])
		expect(
			await run(
				deliver(event("customer.subscription.updated", { ...SUB_ACME, id: "sub_2stranger001" })),
			),
		).toEqual([])
		expect(
			await run(deliver(event("invoice.paid", { ...INVOICE_GLOBEX_OPEN, id: "in_2stranger001" }))),
		).toEqual([])
	})

	it("a subscription event writes the subscription's current state, discounts and plan included", async () => {
		const fake = makeFakeStripe({
			...stripe(),
			// Since the event: a failed renewal, and a coupon the payload carries as an id only.
			subscriptions: [{ ...SUB_ACME, status: "past_due", discounts: [DISCOUNT_20_PERCENT.id] }],
			discounts: [DISCOUNT_20_PERCENT],
		})
		const ops = await run(deliver(event("customer.subscription.updated", SUB_ACME), { fake }))
		expect(ops).toHaveLength(1)
		expect(ops[0]).toMatchObject({
			_tag: "subscription",
			externalId: SUB_ACME.id,
			planName: "Pro",
			status: "past_due",
			mrrMinor: 96_000,
			listMrrMinor: 120_000,
			paymentMethod: { brand: "visa", last4: "4242", expMonth: 4, expYear: 2030 },
		})
		expect(fake.calls).toEqual([
			{
				path: `/subscriptions/${SUB_ACME.id}`,
				params: [
					["expand[]", "discounts"],
					["expand[]", "default_payment_method"],
					["expand[]", "customer.invoice_settings.default_payment_method"],
				],
			},
			{
				path: "/products",
				params: [
					["limit", "100"],
					["ids[]", PRODUCT_PRO.id],
				],
			},
		])
	})

	it("refuses the delivery when Stripe cannot be read now, so Stripe sends it again", async () => {
		for (const failing of [`/subscriptions/${SUB_ACME.id}`, "/products"]) {
			const fake = makeFakeStripe({ ...stripe(), failing: [failing] })
			const error = await run(
				Effect.flip(deliver(event("customer.subscription.updated", SUB_ACME), { fake })),
			)
			// The plan is never named from a lookup that did not happen.
			expect(error.message).toMatch(/retry later/i)
		}
	})

	it("acknowledges an event the key may no longer read, which the next pull reports", async () => {
		const fake = makeFakeStripe({ ...stripe(), forbidden: ["/products"] })
		expect(await run(deliver(event("customer.subscription.updated", SUB_ACME), { fake }))).toEqual([])
	})

	it("an invoice event writes the invoice, a failed payment with a reason ingest can raise", async () => {
		const fake = makeFakeStripe({ ...stripe(), invoices: [INVOICE_GLOBEX_OPEN] })
		const open = await run(deliver(event("invoice.finalized", INVOICE_GLOBEX_OPEN), { fake }))
		expect(open[0]).toMatchObject({ _tag: "invoice", status: "open" })
		expect(open[0]).not.toHaveProperty("declineReason")
		const failed = await run(deliver(event("invoice.payment_failed", INVOICE_GLOBEX_OPEN), { fake }))
		expect(failed[0]).toMatchObject({
			_tag: "invoice",
			status: "open",
			attemptCount: 1,
			declineReason: "Stripe could not collect this payment",
		})
		const action = await run(
			deliver(event("invoice.payment_action_required", INVOICE_GLOBEX_OPEN), { fake }),
		)
		expect(action[0]).toMatchObject({ declineReason: "Stripe could not collect this payment" })
		// A failure event about an invoice paid since writes the paid invoice, no decline.
		const paid = makeFakeStripe({ ...fake, invoices: [{ ...INVOICE_GLOBEX_OPEN, status: "paid" }] })
		const late = await run(deliver(event("invoice.payment_failed", INVOICE_GLOBEX_OPEN), { fake: paid }))
		expect(late[0]).toMatchObject({ status: "paid" })
		expect(late[0]).not.toHaveProperty("declineReason")
	})

	it("a payment method event refreshes the card on the customer's subscriptions", async () => {
		const fake = stripe()
		const ops = await run(deliver(event("payment_method.attached", PAYMENT_METHOD_ACME), { fake }))
		expect(ops).toHaveLength(1)
		expect((ops[0] as UpsertSubscription).paymentMethod).toEqual({
			brand: "visa",
			last4: "4242",
			expMonth: 4,
			expYear: 2030,
		})
		expect(paths(fake)).toEqual(["/subscriptions", "/products"])
		// Only that customer's subscriptions, canceled ones included, read the way a pull reads them.
		expect(fake.calls[0]!.params).toEqual([
			["customer", CUSTOMER_ACME.id],
			["status", "all"],
			["limit", "100"],
			["expand[]", "data.discounts"],
			["expand[]", "data.default_payment_method"],
			["expand[]", "data.customer.invoice_settings.default_payment_method"],
		])
	})

	it("a detached card is cleared, through the customer the event names as its previous one", async () => {
		const fake = makeFakeStripe({
			...stripe(),
			customers: [{ ...CUSTOMER_ACME, invoice_settings: { default_payment_method: null } }],
			subscriptions: [{ ...SUB_ACME, default_payment_method: null }],
		})
		const detached = event(
			"payment_method.detached",
			{ ...PAYMENT_METHOD_ACME, customer: null },
			{
				data: {
					object: { ...PAYMENT_METHOD_ACME, customer: null },
					previous_attributes: { customer: CUSTOMER_ACME.id },
				},
			},
		)
		const ops = await run(deliver(detached, { fake }))
		expect((ops[0] as UpsertSubscription).paymentMethod).toBeNull()
	})

	it("acknowledges a payment method with no customer, and an event type it does not handle", async () => {
		expect(
			await run(deliver(event("payment_method.updated", { ...PAYMENT_METHOD_ACME, customer: null }))),
		).toEqual([])
		expect(await run(deliver(event("charge.succeeded", { id: "ch_1" })))).toEqual([])
		// Drafts are not recorded, and a preview has no id.
		expect(await run(deliver(event("invoice.created", INVOICE_GLOBEX_OPEN)))).toEqual([])
		expect(await run(deliver(event("invoice.upcoming", { ...INVOICE_GLOBEX_OPEN, id: null })))).toEqual(
			[],
		)
	})
})
