/** Connecting: `validate` proves the key, and names the instance it opens when Clerk says. */
import type { ConnectionConfig } from "@hazel/domain/customers"
import { Effect, Redacted } from "effect"
import { describe, expect, it } from "vitest"
import { makeClerkAdapter } from "./adapter"
import { INSTANCE } from "./fixtures"
import { type FakeClerkState, fakeClerkHttpClient, makeFakeClerk } from "./testing"

const API_KEY = "sk_test_fake000000000000000000"
const CONFIG: ConnectionConfig = { _tag: "clerk", createAccounts: true }

const validateWith = (fake: FakeClerkState, apiKey: string) =>
	Effect.gen(function* () {
		const adapter = yield* makeClerkAdapter
		return yield* adapter.validate({
			apiKey: Redacted.make(apiKey),
			webhookSecret: null,
			config: CONFIG,
			externalAccountId: null,
		})
	}).pipe(Effect.provide(fakeClerkHttpClient(fake)))

const validate = (fake: FakeClerkState) => Effect.runPromise(validateWith(fake, API_KEY))

describe("Clerk validate", () => {
	it("names the instance the key opens", async () => {
		const fake = makeFakeClerk({ secretKey: API_KEY, instance: INSTANCE })
		expect(await validate(fake)).toEqual({
			externalAccountId: INSTANCE.id,
			externalAccountName: "Clerk production instance",
		})
		expect(fake.calls.map((call) => call.path)).toEqual(["/organizations", "/instance"])
	})

	it("still connects when `/instance` is refused (403), with no instance to name", async () => {
		expect(await validate(makeFakeClerk({ secretKey: API_KEY, instance: null }))).toEqual({
			externalAccountId: null,
			externalAccountName: null,
		})
	})

	it("refuses a key Clerk rejects as `auth`", async () => {
		const error = await Effect.runPromise(
			Effect.flip(validateWith(makeFakeClerk({ secretKey: API_KEY }), "sk_test_wrong")),
		)
		expect(error).toMatchObject({ code: "auth", httpStatus: 401 })
	})
})
