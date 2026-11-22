/**
 * What the registry derives must equal the tables core held before the integrations moved out: the
 * expected values below are those tables, copied.
 */
import { SignalTemplate } from "@hazel/domain/customers"
import { Effect, Option } from "effect"
import { describe, expect, it } from "vitest"
import { configReader } from "./kit/config"
import { MapleConnectionConfig } from "./maple/config"
import {
	activityProviders,
	billingPreferenceOrder,
	billingProviders,
	decodeConnectionConfig,
	DEFAULT_ATTENTION_SETTINGS,
	DEFAULT_CONNECTION_CONFIG,
	FIELD_PRECEDENCE,
	ingestPolicyOf,
	integrationOf,
	integrations,
	invoiceProviders,
	isIntegrationId,
	requiredSourcesOf,
	usageInvoiceProviders,
} from "./registry"
import { StripeConnectionConfig } from "./stripe/config"

const OLD_FIELD_PRECEDENCE = new Map<string, ReadonlyArray<string>>([
	["name", ["hazel", "clerk", "stripe", "autumn", "maple"]],
	["logoUrl", ["hazel", "clerk", "stripe", "autumn"]],
	["seatsUsed", ["hazel", "autumn", "clerk"]],
	["seatsLimit", ["hazel", "autumn", "clerk"]],
	["email", ["clerk", "stripe", "autumn", "maple"]],
	["avatarUrl", ["clerk", "maple"]],
	["role", ["clerk"]],
])

const ACTIVITY = ["clerk", "maple"]
const BILLING = ["stripe", "autumn"]
const OLD_REQUIRED_SOURCES = {
	inactive: ACTIVITY,
	usage_drop: ACTIVITY,
	payment_failed: BILLING,
	cancel_scheduled: BILLING,
	trial_ending_low_activation: BILLING,
	onboarding_stalled: ACTIVITY,
	health_drop: [],
	champion_inactive: ACTIVITY,
	near_limit: ["autumn"],
	seat_growth: ACTIVITY,
	churned: BILLING,
	response_overdue: [],
	resolution_overdue: [],
} satisfies Record<SignalTemplate, ReadonlyArray<string>>

const OLD_LINK_HOSTS = {
	clerk: ["clerk.com"],
	stripe: ["stripe.com"],
	autumn: ["useautumn.com"],
	maple: ["maple.dev"],
}

describe("the registry", () => {
	it("derives the field precedence core held, order and manual edits included", () => {
		expect([...FIELD_PRECEDENCE]).toEqual([...OLD_FIELD_PRECEDENCE])
	})

	it("resolves every template to the sources it required", () => {
		for (const template of SignalTemplate.literals) {
			expect(requiredSourcesOf(template), template).toEqual(OLD_REQUIRED_SOURCES[template])
		}
	})

	it("keeps the capability lists, the stored attention default and the link hosts", () => {
		expect(integrations.map((integration) => integration.id)).toEqual([
			"clerk",
			"stripe",
			"autumn",
			"maple",
		])
		expect(activityProviders).toEqual(ACTIVITY)
		expect(billingProviders).toEqual(BILLING)
		expect(billingPreferenceOrder.map((entry) => entry.provider)).toEqual(["autumn", "stripe"])
		expect(invoiceProviders).toEqual(["stripe"])
		expect(usageInvoiceProviders).toEqual(["stripe"])
		expect(JSON.stringify(DEFAULT_ATTENTION_SETTINGS)).toBe(
			'{"stages":["lead","trialing","active","past_due"],"requiredSources":["stripe"]}',
		)
		for (const [id, hosts] of Object.entries(OLD_LINK_HOSTS)) {
			expect(integrationOf(id)?.ingest.linkHosts).toEqual(hosts)
		}
		expect(isIntegrationId("nope")).toBe(false)
	})

	it("reads legacy stored configs through the integration's schema", () => {
		const maple = { _tag: "maple", activityEvents: [], metricMappings: [], lookbackDays: 30 }
		const legacy = { ...maple, mapleOrgId: "org_a", accountKey: "GroupId", userKey: "UserId" }
		expect(decodeConnectionConfig("maple", legacy)).toEqual(Option.some({ ...maple, region: "us" }))
		const stripe = { _tag: "stripe", clerkOrgMetadataKey: "org", matchByDomain: false }
		expect(decodeConnectionConfig("stripe", stripe)).toEqual(Option.some({ ...stripe, accountId: "" }))
		expect(Option.isNone(decodeConnectionConfig("nope", maple))).toBe(true)
		expect(Option.isNone(decodeConnectionConfig("clerk", maple))).toBe(true)
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
