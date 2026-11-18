/**
 * Connecting: `validate` proves the key, and names the instance it opens. Feature flags:
 * `setFeatureFlags` merges into the metadata and never overwrites a non-boolean key.
 */
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

	it("refuses to connect when `/instance` is refused (403): there is no instance id to record", async () => {
		const error = await Effect.runPromise(
			Effect.flip(validateWith(makeFakeClerk({ secretKey: API_KEY, instance: null }), API_KEY)),
		)
		expect(error).toMatchObject({ code: "provider", httpStatus: 403 })
		expect(error.message).toMatch(/which instance/i)
	})

	it("refuses a key Clerk rejects as `auth`", async () => {
		const error = await Effect.runPromise(
			Effect.flip(validateWith(makeFakeClerk({ secretKey: API_KEY }), "sk_test_wrong")),
		)
		expect(error).toMatchObject({ code: "auth", httpStatus: 401 })
	})
})

describe("Clerk setFeatureFlags", () => {
	const credentials = {
		apiKey: Redacted.make(API_KEY),
		webhookSecret: null,
		config: CONFIG,
		externalAccountId: null,
	}
	const set = (fake: FakeClerkState, changes: Record<string, boolean | null>) =>
		Effect.gen(function* () {
			const adapter = yield* makeClerkAdapter
			return yield* adapter.setFeatureFlags!(credentials, "org_1", changes)
		}).pipe(Effect.provide(fakeClerkHttpClient(fake)))

	it("sets and removes boolean keys, keeping the rest of the metadata", async () => {
		const org = { id: "org_1", public_metadata: { beta: true, plan: "pro" } }
		const fake = makeFakeClerk({ secretKey: API_KEY, organizations: [org] })
		expect(await Effect.runPromise(set(fake, { beta: null, new_nav: true }))).toEqual({ new_nav: true })
		expect(org.public_metadata).toEqual({ plan: "pro", new_nav: true })
	})

	it("refuses to turn on a key that holds non-boolean metadata, writing nothing", async () => {
		const org = { id: "org_1", public_metadata: { plan: "pro" } }
		const fake = makeFakeClerk({ secretKey: API_KEY, organizations: [org] })
		const error = await Effect.runPromise(Effect.flip(set(fake, { plan: true })))
		expect(error.message).toBe("plan already holds non-boolean metadata in Clerk")
		expect(org.public_metadata).toEqual({ plan: "pro" })
		expect(fake.calls.map((call) => call.path)).toEqual(["/organizations/org_1"])
	})
})
