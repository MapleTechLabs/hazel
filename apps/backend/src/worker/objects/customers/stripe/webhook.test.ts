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
		// Unchecked only when the key may not read which account it opens.
		expect(tags(await run(deliver(body, { accountId: null })))).toEqual(["account"])
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
	it("customer.created writes the account and its billing contact", async () => {
		const ops = await run(deliver(event("customer.created", CUSTOMER_ACME)))
		expect(tags(ops)).toEqual(["account", "contact"])
		const account = ops[0] as UpsertAccount
		expect(account.sameAs).toEqual([{ provider: "clerk", externalId: ORG_ACME }])
		// Stripe customers have no `updated` of their own: the event's time orders them.
		expect(account.observedAt).toBe("2026-11-10T12:00:00.000Z")
	})

	it("customer.deleted stales the ref and writes nothing else", async () => {
		const ops = await run(deliver(event("customer.deleted", { ...CUSTOMER_ACME, deleted: true })))
		expect(ops).toEqual([
			{
				_tag: "account",
				externalId: CUSTOMER_ACME.id,
				sameAs: [],
				onNoMatch: "unmatched",
				deleted: true,
			},
		])
	})

	it("a subscription event writes the subscription, with the product's name fetched once", async () => {
		const fake = stripe()
		const ops = await run(deliver(event("customer.subscription.updated", SUB_ACME), { fake }))
		expect(ops).toHaveLength(1)
		expect(ops[0]).toMatchObject({
			_tag: "subscription",
			externalId: SUB_ACME.id,
			planName: "Pro",
			status: "active",
			mrrMinor: 120_000,
		})
		expect(fake.calls.map((call) => call.path)).toEqual([`/products/${PRODUCT_PRO.id}`])
	})

	it("acknowledges a subscription event whose product cannot be read, with what it knows", async () => {
		const fake = stripe()
		const withNickname = {
			...SUB_ACME,
			items: {
				data: [
					{
						quantity: 1,
						price: {
							unit_amount: 10_000,
							currency: "usd",
							nickname: "Pro monthly",
							product: "prod_missing00001",
							recurring: { interval: "month", interval_count: 1 },
						},
					},
				],
			},
		}
		const ops = await run(deliver(event("customer.subscription.updated", withNickname), { fake }))
		expect(ops[0]).toMatchObject({ planName: "Pro monthly", mrrMinor: 10_000 })
		expect(fake.calls.map((call) => call.path)).toEqual(["/products/prod_missing00001"])
	})

	it("a trial_will_end or a deletion is the same write: the subscription's new state", async () => {
		const trial = await run(deliver(event("customer.subscription.trial_will_end", SUB_GLOBEX)))
		expect(trial[0]).toMatchObject({ status: "trialing", planName: "Extra seats" })
		const deleted = await run(
			deliver(
				event("customer.subscription.deleted", {
					...SUB_ACME,
					status: "canceled",
					canceled_at: SUB_ACME.created,
				}),
			),
		)
		expect(deleted[0]).toMatchObject({ status: "canceled", mrrMinor: 120_000 })
	})

	it("an invoice event writes the invoice, a failed payment with a reason ingest can raise", async () => {
		const open = await run(deliver(event("invoice.finalized", INVOICE_GLOBEX_OPEN)))
		expect(open[0]).toMatchObject({ _tag: "invoice", status: "open", declineReason: null })
		const failed = await run(deliver(event("invoice.payment_failed", INVOICE_GLOBEX_OPEN)))
		expect(failed[0]).toMatchObject({
			_tag: "invoice",
			status: "open",
			attemptCount: 1,
			declineReason: "Stripe could not collect this payment",
		})
		const action = await run(deliver(event("invoice.payment_action_required", INVOICE_GLOBEX_OPEN)))
		expect(action[0]).toMatchObject({ declineReason: "Stripe could not collect this payment" })
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
		expect(fake.calls.map((call) => call.path)).toEqual(["/subscriptions", `/products/${PRODUCT_PRO.id}`])
		// Only that customer's subscriptions, canceled ones included.
		expect(fake.calls[0]!.params).toEqual([
			["customer", CUSTOMER_ACME.id],
			["status", "all"],
			["limit", "100"],
			["expand[]", "data.default_payment_method"],
			["expand[]", "data.discounts"],
		])
	})

	it("acknowledges a payment method with no customer, and an event type it does not handle", async () => {
		expect(
			await run(deliver(event("payment_method.updated", { ...PAYMENT_METHOD_ACME, customer: null }))),
		).toEqual([])
		expect(await run(deliver(event("charge.succeeded", { id: "ch_1" })))).toEqual([])
		expect(await run(deliver(event("invoice.upcoming", { ...INVOICE_GLOBEX_OPEN, id: null })))).toEqual(
			[],
		)
	})
})
