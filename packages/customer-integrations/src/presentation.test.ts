/**
 * What the pages read about each integration must equal what they held before it moved out: the
 * expected values are those tables, copied.
 */
import { describe, expect, it } from "vitest"
import { OLD_DESCRIPTORS } from "./presentation.reference"
import {
	impersonationIntegration,
	integrations,
	meteredProviders,
	startingIntegration,
	suggestedBillingIntegration,
} from "./registry"

const OLD_TEXT = {
	clerk: {
		accountNoun: "organization",
		setupSummary: "Your customer list: accounts and their contacts.",
		sharedIdLabel: undefined,
	},
	stripe: {
		accountNoun: "customer",
		setupSummary: "Subscriptions, invoices and MRR.",
		sharedIdLabel: "metadata.clerk_org_id",
	},
	autumn: {
		accountNoun: "customer",
		setupSummary: "Plans, metered features and limits.",
		sharedIdLabel: "customer ID",
	},
	maple: {
		accountNoun: "group",
		setupSummary: "Product usage and active users.",
		sharedIdLabel: "GroupId",
	},
}

const OLD_MAPLE_SETTINGS = {
	stringList: {
		key: "activityEvents",
		title: "Activity events",
		description: "A contact is active on a day they send one of these events. None: every event counts.",
		emptyText: "Every event counts as activity.",
		placeholder: "Event name, e.g. query_run",
		addLabel: "Add an activity event",
	},
	keyValueList: {
		key: "metricMappings",
		title: "Per-account metrics",
		description:
			"A daily count per account of each mapped event, under its metric key. Usable in charts, signals and health.",
		emptyText: "No event is mapped to a metric yet.",
		columns: [
			{ key: "event", label: "Event", placeholder: "dashboard_created" },
			{ key: "metricKey", label: "Metric key", placeholder: "dashboards_created" },
		],
		itemNoun: "metric",
		note: "Changing a key keeps history under the old key.",
		incompleteProblem: "Fill in or remove the empty metric rows",
	},
	number: {
		key: "lookbackDays",
		title: "Lookback",
		description: "How much history a backfill imports.",
		ariaLabel: "Lookback window",
		options: [
			{ value: 30, label: "30d" },
			{ value: 90, label: "90d" },
			{ value: 180, label: "180d" },
			{ value: 365, label: "1y" },
		],
		unit: "days",
	},
}

type Registered = (typeof integrations)[number]
type Held = Extract<Registered, { readonly id: keyof typeof OLD_DESCRIPTORS }>

/** The integrations the old tables held: one registered later is not part of what they pin. */
const held = integrations.filter((integration: Registered): integration is Held =>
	Object.hasOwn(OLD_DESCRIPTORS, integration.id),
)

describe("integration presentation", () => {
	it("lists the integrations in the old order", () => {
		expect(held.map((integration) => integration.id)).toEqual(Object.keys(OLD_DESCRIPTORS))
	})

	it.each(held)("$id deep-equals its old descriptor", (integration) => {
		const { provider, ...old } = OLD_DESCRIPTORS[integration.id]
		const moved = Object.fromEntries(
			Object.entries(integration.presentation).filter(([key]) => Object.hasOwn(old, key)),
		)
		expect(provider).toBe(integration.id)
		expect(moved).toEqual(old)
	})

	it.each(held)("$id keeps the text the pages held", (integration) => {
		const { accountNoun, setupSummary, sharedIdLabel } = integration.presentation
		expect({ accountNoun, setupSummary, sharedIdLabel }).toEqual(OLD_TEXT[integration.id])
	})

	it("only the integration with those settings declares them, with the old labels", () => {
		expect(held.filter((integration) => integration.presentation.settings).map(({ id }) => id)).toEqual([
			"maple",
		])
		expect(held.find(({ id }) => id === "maple")?.presentation.settings).toEqual(OLD_MAPLE_SETTINGS)
	})

	it("suggests one starting point and one billing source", () => {
		const suggested = (kind: string) =>
			integrations
				.filter((integration) => integration.presentation.suggested === kind)
				.map(({ id }) => id)
		expect(suggested("start")).toEqual(["clerk"])
		expect(suggested("billing")).toEqual(["stripe"])
		expect(startingIntegration.id).toBe("clerk")
		expect(suggestedBillingIntegration.id).toBe("stripe")
	})

	it("gates the tool-specific sections on the same integrations", () => {
		expect(meteredProviders.filter((id) => Object.hasOwn(OLD_DESCRIPTORS, id))).toEqual(["autumn"])
		expect(impersonationIntegration?.id).toBe("clerk")
		expect(impersonationIntegration?.presentation.impersonationNote).toBe(
			"Turn it on in the Clerk dashboard (Settings → User impersonation). Clerk allows 5 impersonations a month without the Administration add-on.",
		)
	})
})
