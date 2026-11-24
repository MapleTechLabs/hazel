/**
 * Connecting: `validate` proves the key reads everything a pull needs, and names the organization
 * *and* environment it opens — the pair core tells a changed account by, and the pair a sandbox key
 * next to a live signing secret must not slip past.
 */
import { Effect, Redacted } from "effect"
import { describe, expect, it } from "vitest"
import { makeAutumnAdapter, envOfAccountId } from "./adapter"
import { CUSTOMERS, FEATURES, ORGANIZATION, ORG_ME, PLANS, SUB_ACME, SUB_ACME_EXPIRED } from "./fixtures"
import { encodeCursor } from "./pull"
import { type FakeAutumnState, fakeAutumnHttpClient, makeFakeAutumn } from "./testing"
import { envOfKey } from "./wire"

const API_KEY = "am_sk_live_fake0000000000000000"

const validateWith = (fake: FakeAutumnState, apiKey: string) =>
	Effect.gen(function* () {
		const adapter = yield* makeAutumnAdapter
		return yield* adapter.validate({
			apiKey: Redacted.make(apiKey),
			webhookSecret: null,
			config: { _tag: "autumn", customerIdIsClerkOrgId: true },
			externalAccountId: null,
		})
	}).pipe(Effect.provide(fakeAutumnHttpClient(fake)))

const organization = (options: Partial<FakeAutumnState> = {}) =>
	makeFakeAutumn({
		apiKey: API_KEY,
		me: ORG_ME,
		organization: ORGANIZATION,
		features: FEATURES,
		plans: PLANS,
		customers: CUSTOMERS,
		subscriptions: [SUB_ACME],
		...options,
	})

const validate = (fake: FakeAutumnState, apiKey = API_KEY) => Effect.runPromise(validateWith(fake, apiKey))

const refusal = (fake: FakeAutumnState, apiKey = API_KEY) =>
	Effect.runPromise(Effect.flip(validateWith(fake, apiKey)))

describe("Autumn validate", () => {
	it("reads each endpoint once and names the organization and its environment", async () => {
		const fake = organization()
		expect(await validate(fake)).toEqual({
			externalAccountId: `${ORG_ME.id}:live`,
			externalAccountName: "Hazel (live)",
		})
		expect(fake.calls.map((call) => call.path)).toEqual([
			"/v1/organization/me",
			// The pricing every pull and delivery needs: the plans and the currency they are quoted in.
			"/v1/plans.list",
			"/v1/organization",
			"/v1/features.list",
			"/v1/customers.list",
			"/v1/subscriptions.list",
		])
		// One record of each is all it takes, read the way the pull reads it.
		expect(fake.calls[1]!.body).toEqual({ include_archived: true })
		expect(fake.calls[4]!.body).toEqual({ start_cursor: "", limit: 1 })
		expect(fake.calls[5]!.body).toEqual({
			start_cursor: "",
			limit: 1,
			statuses: ["active", "past_due", "scheduled", "expired"],
		})
		// The version is pinned on every request, and the key only travels in the header.
		expect(new Set(fake.versions)).toEqual(new Set(["2.5.0"]))
		expect(new Set(fake.authHeaders)).toEqual(new Set([`Bearer ${API_KEY}`]))
	})

	it("refuses a sandbox key paired with a live organization, and the other way round", async () => {
		const sandboxKey = "am_sk_test_fake0000000000000000"
		const liveOrg = organization({ apiKey: sandboxKey })
		expect((await refusal(liveOrg, sandboxKey)).message).toBe(
			"The key looks like a sandbox key (am_sk_test_…) but Autumn answers for the live environment",
		)
		const sandboxOrg = organization({ me: { ...ORG_ME, env: "sandbox", is_sandbox: true } })
		expect((await refusal(sandboxOrg)).message).toBe(
			"The key looks like a live key (am_sk_live_…) but Autumn answers for the sandbox",
		)
		expect(
			(
				await validate(
					organization({ apiKey: sandboxKey, me: { ...ORG_ME, env: "sandbox" } }),
					sandboxKey,
				)
			).externalAccountId,
		).toBe(`${ORG_ME.id}:sandbox`)
	})

	it("refuses a key whose prefix says nothing about its environment, before any request", async () => {
		const odd = "am_sk_fake0000000000000000"
		const fake = organization({ apiKey: odd })
		const error = await refusal(fake, odd)
		expect(error.code).toBe("auth")
		expect(error.message).toMatch(/is what an Autumn secret key looks like \(Autumn → Developer → Keys\)/)
		expect(envOfKey(odd)).toBeNull()
		expect(fake.calls).toHaveLength(0)
	})

	it("names the currency endpoint when the key cannot read it", async () => {
		const error = await refusal(organization({ forbidden: ["/v1/organization"] }))
		expect(error.message).toMatch(/Autumn refused GET \/v1\/organization for this key \(403\)/)
	})

	it("falls back to the environment when the organization has no name", async () => {
		const unnamed = await validate(organization({ me: { ...ORG_ME, name: null } }))
		expect(unnamed.externalAccountName).toBe("Autumn live")
	})

	it("refuses a key Autumn rejects", async () => {
		const error = await refusal(organization(), "am_sk_live_wrong")
		expect(error).toMatchObject({ code: "auth", httpStatus: 401 })
		expect(error.message).toMatch(/Autumn rejected the secret key \(401\): Invalid secret key/)
	})

	it("names the endpoint a key cannot read, at connect time", async () => {
		const fake = organization({ forbidden: ["/v1/subscriptions.list"] })
		const error = await refusal(fake)
		expect(error).toMatchObject({ code: "auth", httpStatus: 403 })
		expect(error.message).toMatch(/Autumn refused POST \/v1\/subscriptions.list for this key \(403\)/)
		// It stops there: nothing after the refused endpoint is asked for.
		expect(fake.calls.map((call) => call.path).at(-1)).toBe("/v1/subscriptions.list")
	})

	it("passes on a refusal to say which organization the key opens", async () => {
		const error = await refusal(organization({ me: null }))
		expect(error).toMatchObject({ code: "auth", httpStatus: 403 })
		expect(error.message).toMatch(/GET \/v1\/organization\/me for this key \(403\)/)
	})

	it("pulls only for a validated connection, and reuses its pricing for a few minutes", async () => {
		const fake = organization({ subscriptions: [SUB_ACME_EXPIRED] })
		const pullAt = (externalAccountId: string | null) =>
			Effect.gen(function* () {
				const adapter = yield* makeAutumnAdapter
				return yield* adapter.pull({
					credentials: {
						apiKey: Redacted.make(API_KEY),
						webhookSecret: null,
						config: { _tag: "autumn", customerIdIsClerkOrgId: true },
						externalAccountId,
					},
					cursor: encodeCursor({ phase: "subscriptions", after: null }),
					since: null,
				})
			}).pipe(Effect.provide(fakeAutumnHttpClient(fake)))
		const unvalidated = await Effect.runPromise(Effect.flip(pullAt(null)))
		expect(unvalidated).toMatchObject({ code: "auth" })
		expect(fake.calls).toHaveLength(0)
		const account = `${ORG_ME.id}:live`
		await Effect.runPromise(pullAt(account))
		await Effect.runPromise(pullAt(account))
		expect(fake.calls.filter((call) => call.path === "/v1/plans.list")).toHaveLength(1)
		expect(fake.calls.filter((call) => call.path === "/v1/subscriptions.list")).toHaveLength(2)
	})

	it("reads the environment back off a stored account id", () => {
		expect(envOfAccountId(`${ORG_ME.id}:live`)).toBe("live")
		expect(envOfAccountId(`${ORG_ME.id}:sandbox`)).toBe("sandbox")
		expect(envOfAccountId(ORG_ME.id)).toBeNull()
		expect(envOfAccountId(null)).toBeNull()
	})
})
