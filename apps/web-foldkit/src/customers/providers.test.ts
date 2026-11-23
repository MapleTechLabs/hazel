import { billingPreferenceOrder, billingProviders } from "@hazel/customer-integrations"
import { describe, expect, it } from "vitest"
import {
	connectBillingTitle,
	featureFlagsSource,
	impersonationSource,
	namesLabel,
	PROVIDER_ORDER,
	providerOf,
	safeSourceUrl,
	sourceLabel,
	sourcesLabel,
	startingSource,
	suggestedBillingSource,
	usageSources,
} from "./providers"

/** The copy built from the registry must read as the literals it replaced. */
describe("customers copy from the registry", () => {
	it("names the sources in the old order", () => {
		expect(namesLabel(PROVIDER_ORDER.map(sourceLabel))).toBe("Clerk, Stripe, Autumn and Maple")
		expect(sourceLabel("hazel")).toBe("Hazel")
	})

	it("says what billing needs", () => {
		expect(connectBillingTitle()).toBe("Connect Stripe or Autumn to see revenue")
		expect(sourcesLabel(billingProviders)).toBe("Stripe or Autumn")
		expect(billingPreferenceOrder.map(({ provider }) => providerOf(provider).name)).toEqual([
			"Autumn",
			"Stripe",
		])
		expect(suggestedBillingSource.name).toBe("Stripe")
	})

	it("starts first-run copy at the same source", () => {
		expect(startingSource.name).toBe("Clerk")
		expect(startingSource.accountNoun).toBe("organization")
		expect(featureFlagsSource.name).toBe("Clerk")
		expect(impersonationSource.name).toBe("Clerk")
	})

	it("names usage sources with the activity they bring", () => {
		expect(
			namesLabel(
				usageSources.map(
					(source) => `${providerOf(source).name} ${providerOf(source).activityLabel?.noun}`,
				),
			),
		).toBe("Maple events and Clerk sign-ins")
	})

	it("shows an id this build does not know by its id, with no links", () => {
		expect(sourceLabel("newtool")).toBe("newtool")
		expect(safeSourceUrl("newtool", "https://newtool.dev/record")).toBeNull()
	})
})
