/**
 * Connecting: `validate` proves the key can read `product_events` and names the organization *and*
 * region it opens — the pair core tells a changed account by, and the pair that keeps a key of one
 * region from being read as the other's.
 */
import type { ConnectionConfig } from "@hazel/domain/customers"
import { Effect, Redacted } from "effect"
import { describe, expect, it } from "vitest"
import { accountIdOf, makeMapleAdapter, regionOfAccountId } from "./adapter"
import { MAPLE_ORG } from "./fixtures"
import { encodeCursor } from "./pull"
import { type FakeMapleState, fakeMapleHttpClient, makeFakeMaple, originOf } from "./testing"

const API_KEY = "maple_ak_fake0000000000000000"

const config = (overrides: Partial<Extract<ConnectionConfig, { _tag: "maple" }>> = {}) =>
	({
		_tag: "maple",
		mapleOrgId: MAPLE_ORG,
		region: "us",
		activityEvents: [],
		metricMappings: [],
		accountKey: "GroupId",
		userKey: "UserId",
		lookbackDays: 90,
		...overrides,
	}) satisfies Extract<ConnectionConfig, { _tag: "maple" }>

const validateWith = (
	fake: FakeMapleState,
	options: { readonly apiKey?: string; readonly config?: ConnectionConfig } = {},
) =>
	Effect.gen(function* () {
		const adapter = yield* makeMapleAdapter
		return yield* adapter.validate({
			apiKey: Redacted.make(options.apiKey ?? API_KEY),
			webhookSecret: null,
			config: options.config ?? config(),
			externalAccountId: null,
		})
	}).pipe(Effect.provide(fakeMapleHttpClient(fake)))

const organization = (options: Partial<FakeMapleState> = {}) =>
	makeFakeMaple({ apiKey: API_KEY, organizationId: MAPLE_ORG, ...options })

const validate = (fake: FakeMapleState, options?: Parameters<typeof validateWith>[1]) =>
	Effect.runPromise(validateWith(fake, options))

const refusal = (fake: FakeMapleState, options?: Parameters<typeof validateWith>[1]) =>
	Effect.runPromise(Effect.flip(validateWith(fake, options)))

describe("Maple validate", () => {
	it("names the organization the key opens, and its region, from one counting query", async () => {
		const fake = organization()
		expect(await validate(fake)).toEqual({
			externalAccountId: `${MAPLE_ORG}:us`,
			externalAccountName: "Maple (US)",
		})
		expect(fake.calls).toHaveLength(1)
		// A window far in the past: the probe proves the access, not the data.
		expect(fake.calls[0]).toMatchObject({
			start: "2019-01-01 00:00:00",
			end: "2019-01-02 00:00:00",
		})
		expect(fake.calls[0]?.sql).toContain("$__orgFilter")
		expect(new Set(fake.authHeaders)).toEqual(new Set([`Bearer ${API_KEY}`]))
	})

	it("validates against the region's own host", async () => {
		const fake = organization()
		const account = await validate(fake, { config: config({ region: "eu" }) })
		expect(account).toEqual({
			externalAccountId: `${MAPLE_ORG}:eu`,
			externalAccountName: "Maple (EU)",
		})
		expect(fake.paths).toEqual([originOf("eu")])
	})

	it("refuses a key that is not a Maple API key, before any request", async () => {
		const fake = organization()
		const error = await refusal(fake, { apiKey: "sk_live_not_maple" })
		expect(error.code).toBe("auth")
		expect(error.message).toMatch(/"maple_ak_…" is what a Maple API key looks like/)
		expect(fake.calls).toHaveLength(0)
	})

	it("refuses a key that opens another Maple organization than the source is set to", async () => {
		const error = await refusal(organization({ organizationId: "org_someoneelse" }))
		expect(error.code).toBe("auth")
		expect(error.message).toBe(
			`The key opens Maple organization org_someoneelse, not the ${MAPLE_ORG} this source is set to`,
		)
	})

	it("refuses a key Maple rejects, and one without the MCP tools", async () => {
		const rejected = await refusal(organization(), { apiKey: "maple_ak_wrong" })
		expect(rejected).toMatchObject({ code: "auth", httpStatus: 401 })
		const forbidden = await refusal(organization({ forbidden: true }))
		expect(forbidden).toMatchObject({ code: "auth", httpStatus: 403 })
		expect(forbidden.message).toMatch(/MCP tools \(403\)/)
	})

	it("names the identity columns Maple actually stamps its events with", async () => {
		const account = await refusal(organization(), { config: config({ accountKey: "OrgSlug" }) })
		expect(account.message).toMatch(/Maple stamps the account on its events as "GroupId"/)
		const user = await refusal(organization(), { config: config({ userKey: "Email" }) })
		expect(user.message).toMatch(/Maple stamps the user on its events as "UserId"/)
	})

	it("refuses a config that is not Maple's", async () => {
		const error = await refusal(organization(), {
			config: { _tag: "clerk", createAccounts: true },
		})
		expect(error.message).toBe("The Maple connection has no Maple settings; reconnect it")
	})

	it("reads the region back off a stored account id", () => {
		expect(accountIdOf(MAPLE_ORG, "eu")).toBe(`${MAPLE_ORG}:eu`)
		expect(regionOfAccountId(`${MAPLE_ORG}:us`)).toBe("us")
		expect(regionOfAccountId(`${MAPLE_ORG}:eu`)).toBe("eu")
		expect(regionOfAccountId(MAPLE_ORG)).toBeNull()
		expect(regionOfAccountId(null)).toBeNull()
	})
})

describe("Maple adapter", () => {
	const pullAt = (fake: FakeMapleState, externalAccountId: string | null, settings = config()) =>
		Effect.gen(function* () {
			const adapter = yield* makeMapleAdapter
			return yield* adapter.pull({
				credentials: {
					apiKey: Redacted.make(API_KEY),
					webhookSecret: null,
					config: settings,
					externalAccountId,
				},
				cursor: encodeCursor({ day: "2026-06-14", phase: "activity", until: "2026-06-14" }),
				since: null,
			})
		}).pipe(Effect.provide(fakeMapleHttpClient(fake)))

	it("pulls only for a validated connection", async () => {
		const fake = organization()
		const error = await Effect.runPromise(Effect.flip(pullAt(fake, null)))
		expect(error).toMatchObject({ code: "auth" })
		expect(error.message).toBe("The Maple connection has no validated account; reconnect it")
		expect(fake.calls).toHaveLength(0)
		await Effect.runPromise(pullAt(fake, `${MAPLE_ORG}:us`))
		expect(fake.calls).toHaveLength(1)
	})

	it("refuses to read a region the key was never checked against", async () => {
		const fake = organization()
		const error = await Effect.runPromise(
			Effect.flip(pullAt(fake, `${MAPLE_ORG}:us`, config({ region: "eu" }))),
		)
		expect(error.message).toBe(
			"The region was changed since the key was checked; reconnect with a key of it",
		)
		expect(fake.calls).toHaveLength(0)
	})

	it("takes no webhook: Maple sends none for a product event", async () => {
		const adapter = await Effect.runPromise(
			makeMapleAdapter.pipe(Effect.provide(fakeMapleHttpClient(organization()))),
		)
		expect(adapter.pullIntervalMs).toBe(60 * 60_000)
		const refused = await Effect.runPromise(
			Effect.flip(
				adapter.webhook(
					{ headers: {}, body: "{}" },
					{
						apiKey: Redacted.make(API_KEY),
						webhookSecret: Redacted.make("whsec"),
						config: config(),
						externalAccountId: `${MAPLE_ORG}:us`,
					},
				),
			),
		)
		expect(refused.message).toBe("Maple sends Hazel no webhooks")
	})
})
