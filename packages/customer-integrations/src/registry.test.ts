/** How the registry reads a connection's stored config. Stored rows predate some of today's fields. */
import { Effect, Option } from "effect"
import { describe, expect, it } from "vitest"
import { configReader } from "./kit/config"
import { MapleConnectionConfig } from "./maple/config"
import { DEFAULT_CONNECTION_CONFIG, ingestPolicyOf, integrationOf } from "./registry"
import { StripeConnectionConfig } from "./stripe/config"

describe("the registry", () => {
	it("reads legacy stored configs through the integration's schema", () => {
		const maple = { _tag: "maple", activityEvents: [], metricMappings: [], lookbackDays: 30 }
		const legacy = { ...maple, mapleOrgId: "org_a", accountKey: "GroupId", userKey: "UserId" }
		expect(integrationOf("maple")?.config.decode(legacy)).toEqual(Option.some({ ...maple, region: "us" }))
		const stripe = { _tag: "stripe", clerkOrgMetadataKey: "org", matchByDomain: false }
		expect(integrationOf("stripe")?.config.decode(stripe)).toEqual(
			Option.some({ ...stripe, accountId: "" }),
		)
		expect(integrationOf("clerk")?.config.decode(maple)).toEqual(Option.none())
	})

	it("gives an adapter the decoded config", async () => {
		const legacy = {
			_tag: "maple",
			activityEvents: [],
			metricMappings: [],
			lookbackDays: 30,
			mapleOrgId: "org_a",
		}
		const maple = await Effect.runPromise(configReader(MapleConnectionConfig, "Maple")(legacy))
		expect(maple).toEqual({
			_tag: "maple",
			activityEvents: [],
			metricMappings: [],
			lookbackDays: 30,
			region: "us",
		})
		const stripe = await Effect.runPromise(
			configReader(
				StripeConnectionConfig,
				"Stripe",
			)({
				_tag: "stripe",
				clerkOrgMetadataKey: "org",
				matchByDomain: true,
			}),
		)
		expect(stripe.accountId).toBe("")
	})

	it("reads the ingest policy from the config it is given", () => {
		const open = { matchByDomain: true, createAccounts: true }
		expect(ingestPolicyOf(null)).toEqual(open)
		expect(ingestPolicyOf(DEFAULT_CONNECTION_CONFIG.autumn)).toEqual(open)
		expect(ingestPolicyOf(DEFAULT_CONNECTION_CONFIG.maple)).toEqual(open)
		expect(ingestPolicyOf({ _tag: "clerk", createAccounts: false })).toEqual({
			matchByDomain: true,
			createAccounts: false,
		})
		// A stored config from before `accountId` still carries its policy.
		expect(ingestPolicyOf({ _tag: "stripe", clerkOrgMetadataKey: "org", matchByDomain: false })).toEqual({
			matchByDomain: false,
			createAccounts: true,
		})
	})
})
