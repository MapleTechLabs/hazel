/** Connecting: `validate` proves the key reads everything a pull needs, and names the account. */
import type { ConnectionConfig } from "@hazel/domain/customers"
import { Effect, Redacted } from "effect"
import { describe, expect, it } from "vitest"
import { livemodeOfKey, makeStripeAdapter } from "./adapter"
import { ACCOUNT } from "./fixtures"
import { type FakeStripeState, fakeStripeHttpClient, makeFakeStripe } from "./testing"

const API_KEY = "rk_test_fake000000000000000000"
const CONFIG: ConnectionConfig = {
	_tag: "stripe",
	clerkOrgMetadataKey: "clerk_org_id",
	matchByDomain: true,
}

const validateWith = (fake: FakeStripeState, apiKey: string) =>
	Effect.gen(function* () {
		const adapter = yield* makeStripeAdapter
		return yield* adapter.validate({
			apiKey: Redacted.make(apiKey),
			webhookSecret: null,
			config: CONFIG,
			externalAccountId: null,
		})
	}).pipe(Effect.provide(fakeStripeHttpClient(fake)))

const validate = (fake: FakeStripeState) => Effect.runPromise(validateWith(fake, API_KEY))

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
			"/account",
		])
		// One record of each is all it takes.
		expect(fake.calls[0]!.params).toEqual([["limit", "1"]])
		expect(fake.calls[1]!.params).toEqual([
			["limit", "1"],
			["status", "all"],
		])
	})

	it("refuses a key that may not read the account it opens, saying why Hazel needs it", async () => {
		const error = await Effect.runPromise(
			Effect.flip(validateWith(makeFakeStripe({ apiKey: API_KEY, account: null }), API_KEY)),
		)
		expect(error).toMatchObject({ code: "auth", httpStatus: 403 })
		expect(error.message).toMatch(/GET \/account for this key \(403\): The provided key does not have/)
		expect(error.message).toMatch(/keep Stripe accounts apart/)
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
