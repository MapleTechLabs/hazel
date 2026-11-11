/**
 * Connecting: `validate` proves the key reads everything a pull needs, and names the account: read
 * with a secret key, entered (and checked where Stripe gives it away) with a restricted one.
 */
import type { ConnectionConfig } from "@hazel/domain/customers"
import { Effect, Redacted } from "effect"
import { describe, expect, it } from "vitest"
import { livemodeOfKey, makeStripeAdapter } from "./adapter"
import { ACCOUNT, INVOICE_ACME_PAID } from "./fixtures"
import { type FakeStripeState, fakeStripeHttpClient, makeFakeStripe } from "./testing"

const API_KEY = "rk_test_fake000000000000000000"
const CONFIG: ConnectionConfig = {
	_tag: "stripe",
	clerkOrgMetadataKey: "clerk_org_id",
	matchByDomain: true,
	accountId: "",
}

const validateWith = (fake: FakeStripeState, apiKey: string, accountId = "") =>
	Effect.gen(function* () {
		const adapter = yield* makeStripeAdapter
		return yield* adapter.validate({
			apiKey: Redacted.make(apiKey),
			webhookSecret: null,
			config: { ...CONFIG, accountId },
			externalAccountId: null,
		})
	}).pipe(Effect.provide(fakeStripeHttpClient(fake)))

const validate = (fake: FakeStripeState, accountId = "") =>
	Effect.runPromise(validateWith(fake, API_KEY, accountId))

const refusal = (fake: FakeStripeState, accountId = "") =>
	Effect.runPromise(Effect.flip(validateWith(fake, API_KEY, accountId)))

describe("Stripe validate", () => {
	it("reads each resource once and names the account the key opens", async () => {
		const fake = makeFakeStripe({ apiKey: API_KEY, account: ACCOUNT })
		expect(await validate(fake)).toEqual({
			externalAccountId: ACCOUNT.id,
			externalAccountName: "Hazel Production",
		})
		expect(fake.calls.map((call) => call.path)).toEqual([
			"/customers",
			"/subscriptions",
			"/invoices",
			"/products",
			"/events",
			"/account",
		])
		// One record of each is all it takes, read the way the pull reads it.
		expect(fake.calls[0]!.params).toEqual([["limit", "1"]])
		expect(fake.calls[1]!.params).toEqual([
			["limit", "1"],
			["status", "all"],
			["expand[]", "data.discounts"],
			["expand[]", "data.default_payment_method"],
			["expand[]", "data.default_source"],
			["expand[]", "data.customer.invoice_settings.default_payment_method"],
			["expand[]", "data.customer.default_source"],
		])
	})

	it("checks an account id entered next to a key that reads its account", async () => {
		expect(
			(await validate(makeFakeStripe({ apiKey: API_KEY, account: ACCOUNT }), ACCOUNT.id))
				.externalAccountId,
		).toBe(ACCOUNT.id)
		const other = await refusal(
			makeFakeStripe({ apiKey: API_KEY, account: ACCOUNT }),
			"acct_1Other0000000000",
		)
		expect(other.message).toBe(`The key opens Stripe account ${ACCOUNT.id}, not acct_1Other0000000000`)
	})

	it("needs the account id with a restricted key, which may not read its own account", async () => {
		const restricted = makeFakeStripe({ apiKey: API_KEY, account: null })
		const error = await refusal(restricted)
		expect(error.code).toBe("auth")
		expect(error.message).toMatch(/enter the account id \(acct_…, Stripe Dashboard → Settings → Business/)
		expect(await validate(makeFakeStripe({ apiKey: API_KEY, account: null }), ` ${ACCOUNT.id} `)).toEqual(
			{
				externalAccountId: ACCOUNT.id,
				externalAccountName: null,
			},
		)
		expect((await refusal(restricted, "1Hazel")).message).toMatch(/is not a Stripe account id/)
	})

	it("refuses an entered account id Stripe's own answers contradict", async () => {
		// Stripe's refusal names the account.
		const named = makeFakeStripe({ apiKey: API_KEY, account: null, refusedOnAccount: ACCOUNT.id })
		expect((await validate(named, ACCOUNT.id)).externalAccountId).toBe(ACCOUNT.id)
		expect((await refusal(named, "acct_1Typo000000000000")).message).toBe(
			`The key belongs to Stripe account ${ACCOUNT.id}, not acct_1Typo000000000000`,
		)
		// Without that, a paid (else open) invoice's hosted URL does.
		const invoiced = makeFakeStripe({ apiKey: API_KEY, account: null, invoices: [INVOICE_ACME_PAID] })
		expect((await refusal(invoiced, "acct_1Typo000000000000")).message).toMatch(
			/belongs to Stripe account acct_1Hazel/,
		)
		const open = makeFakeStripe({
			apiKey: API_KEY,
			account: null,
			invoices: [{ ...INVOICE_ACME_PAID, status: "open" }],
		})
		expect((await refusal(open, "acct_1Typo000000000000")).message).toMatch(
			/belongs to Stripe account acct_1Hazel/,
		)
		expect(
			open.calls.filter((call) => call.path === "/invoices").map((call) => call.params.at(-1)),
		).toEqual([
			["limit", "1"],
			["status", "paid"],
			["status", "open"],
		])
	})

	it("trusts the account a refusal names over any invoice's URL", async () => {
		const fake = makeFakeStripe({
			apiKey: API_KEY,
			account: null,
			refusedOnAccount: ACCOUNT.id,
			invoices: [
				{
					...INVOICE_ACME_PAID,
					hosted_invoice_url: "https://invoice.stripe.com/i/acct_1Other0000000/x",
				},
			],
		})
		expect((await validate(fake, ACCOUNT.id)).externalAccountId).toBe(ACCOUNT.id)
		// The URL is not even looked for.
		expect(fake.calls.filter((call) => call.path === "/invoices")).toHaveLength(1)
	})

	it("passes on a secret key's refusal to read the account", async () => {
		const error = await Effect.runPromise(
			Effect.flip(
				validateWith(
					makeFakeStripe({ apiKey: "sk_test_fake", account: null }),
					"sk_test_fake",
					ACCOUNT.id,
				),
			),
		)
		expect(error).toMatchObject({ code: "auth", httpStatus: 403 })
		expect(error.message).toMatch(/GET \/account for this key \(403\)/)
	})

	it("falls back to the business name, then the account's email", async () => {
		const noDisplayName = await validate(
			makeFakeStripe({ apiKey: API_KEY, account: { ...ACCOUNT, settings: {} } }),
		)
		expect(noDisplayName.externalAccountName).toBe("Hazel")
		const bare = await validate(
			makeFakeStripe({ apiKey: API_KEY, account: { id: ACCOUNT.id, email: "ops@hazel.chat" } }),
		)
		expect(bare.externalAccountName).toBe("ops@hazel.chat")
	})

	it("refuses a key Stripe rejects", async () => {
		const error = await Effect.runPromise(
			Effect.flip(validateWith(makeFakeStripe({ apiKey: API_KEY }), "rk_test_wrong")),
		)
		expect(error).toMatchObject({ code: "auth", httpStatus: 401 })
	})

	it("names the permission a restricted key is missing, at connect time", async () => {
		const fake = makeFakeStripe({ apiKey: API_KEY, account: ACCOUNT, forbidden: ["/invoices"] })
		const error = await Effect.runPromise(Effect.flip(validateWith(fake, API_KEY)))
		expect(error).toMatchObject({ code: "auth", httpStatus: 403 })
		expect(error.message).toMatch(/GET \/invoices for this key \(403\)/)
		// It stops there: the account is never asked for.
		expect(fake.calls.map((call) => call.path)).toEqual(["/customers", "/subscriptions", "/invoices"])
	})

	it("reads the key's mode off its prefix, and says nothing about one that does not carry it", () => {
		expect(livemodeOfKey(Redacted.make("rk_test_abc"))).toBe(false)
		expect(livemodeOfKey(Redacted.make("rk_live_abc"))).toBe(true)
		expect(livemodeOfKey(Redacted.make("sk_live_abc"))).toBe(true)
		expect(livemodeOfKey(Redacted.make("sk_abcdefgh"))).toBeNull()
	})
})
