import type { FixtureServer } from "../fixture-socket"
import type { PageFixture } from "../page-fixture"
import { adaUserId, designChannelId, generalChannelId, orgId, userRows } from "../snapshot"

/**
 * `/hazel/customers/<Northwind>`: three customers (Northwind between Acme and Umbrella, so prev and
 * next both go somewhere), Northwind enriched and linked to #general and #design, with tags, flags,
 * a note, a Stripe record and an active subscription.
 */

const NOW = Date.parse("2026-11-26T15:00:00Z")
const DAY = 24 * 60 * 60 * 1000
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString()

const id = (group: number, index: number) =>
	`${group.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`

export const northwindId = id(0xc1, 2)
const graceUserId = userRows[1]?.id ?? adaUserId

const company = {
	domain: "northwind.io",
	name: "Northwind Labs",
	description: "Northwind builds logistics software for mid-size shippers: routing, tracking and billing.",
	industry: "Software",
	subindustry: "Logistics software",
	employeeRange: "51-200",
	employeeCount: 140,
	headquarters: {
		street: null,
		city: "Berlin",
		region: null,
		postalCode: null,
		country: "Germany",
		countryCode: "DE",
	},
	foundedYear: 2017,
	companyType: "private",
	operatingStatus: null,
	stock: null,
	funding: {
		stage: "series_b",
		totalUsd: 42_000_000,
		rounds: [{ type: "series_b", date: "2025-03-12", amountUsd: 30_000_000 }],
	},
	revenue: { minUsd: 10_000_000, maxUsd: 25_000_000 },
	socials: [],
	pages: [],
	colors: [],
	logoUrl: null,
}

const account = (
	index: number,
	name: string,
	overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> => ({
	id: id(0xc1, index),
	organizationId: orgId,
	name,
	domains: [],
	logoUrl: null,
	ownerUserId: null,
	lifecycleStage: "active",
	lifecycleStageOverride: null,
	planName: "Team",
	mrrMinor: 49_000,
	currency: "USD",
	trialListMrrMinor: null,
	trialEndsAt: null,
	seatsUsed: null,
	seatsLimit: null,
	contactCount: 4,
	activeUsers30d: 3,
	activeUsersTrendPct: null,
	openRiskHigh: 0,
	openRiskMedium: 0,
	openRiskLow: 0,
	openOpportunities: 0,
	championContactId: null,
	championInactiveSince: null,
	lastActiveContactId: null,
	firstSeenAt: at(400),
	lastActiveAt: at(1),
	customerSince: at(380),
	churnedAt: null,
	tags: [],
	attributes: {},
	featureFlags: {},
	attentionMutedAt: null,
	attentionMutedUntil: null,
	attentionMutedByUserId: null,
	fieldSources: {},
	primaryAccountId: null,
	environment: null,
	companyProfile: null,
	companyCheckedAt: null,
	createdAt: at(400),
	updatedAt: at(1),
	deletedAt: null,
	...overrides,
})

const northwind = account(2, "Northwind Labs", {
	domains: ["northwind.io"],
	ownerUserId: graceUserId,
	planName: "Business",
	mrrMinor: 129_900,
	seatsUsed: 18,
	seatsLimit: 25,
	contactCount: 12,
	tags: ["enterprise", "eu"],
	attributes: { region: "EU", plan: "business" },
	featureFlags: { new_billing: true, beta_routing: true, legacy_export: false },
	fieldSources: { lifecycleStage: "stripe", region: "stripe" },
	companyProfile: company,
	companyCheckedAt: at(3),
})

const accounts = [account(1, "Acme Robotics"), northwind, account(3, "Umbrella Health", { mrrMinor: 0 })]

const subscription = {
	id: id(0xc5, 1),
	accountId: northwindId,
	provider: "stripe",
	externalId: "sub_northwind",
	planName: "Business",
	status: "active",
	mrrMinor: 129_900,
	listMrrMinor: null,
	currency: "USD",
	interval: "month",
	quantity: 1,
	startedAt: at(380),
	trialEndsAt: null,
	currentPeriodEnd: new Date(NOW + 12 * DAY).toISOString(),
	cancelAtPeriodEnd: false,
	canceledAt: null,
	cancellationReason: null,
	paymentMethod: null,
	createdAt: at(380),
	updatedAt: at(10),
}

const ref = {
	id: id(0xc6, 1),
	connectionId: id(0xc7, 1),
	provider: "stripe",
	entityType: "account",
	entityId: northwindId,
	accountId: northwindId,
	externalId: "cus_Northwind42",
	name: "Northwind Labs GmbH",
	externalUrl: "https://dashboard.stripe.com/customers/cus_Northwind42",
	matchMethod: "domain",
	matchedByUserId: null,
	matchedAt: at(380),
	lastSyncedAt: at(0.1),
	staleAt: null,
	createdAt: at(380),
	updatedAt: at(0.1),
}

const links = [generalChannelId, designChannelId].map((channelId, index) => ({
	id: id(0xc8, index + 1),
	organizationId: orgId,
	accountId: northwindId,
	channelId,
	linkedBy: index === 0 ? adaUserId : null,
	createdAt: at(30),
	updatedAt: at(30),
	deletedAt: null,
}))

const notes = [
	{
		id: id(0xc9, 1),
		organizationId: orgId,
		accountId: northwindId,
		authorUserId: adaUserId,
		body: "Renewal call booked for December. They want SSO before then.",
		pinned: true,
		signalId: null,
		editedAt: null,
		createdAt: at(2),
		updatedAt: at(2),
		deletedAt: null,
	},
]

const flags = ["new_billing", "beta_routing", "legacy_export", "dark_launch"].map((key, index) => ({
	id: id(0xca, index + 1),
	organizationId: orgId,
	key,
	createdBy: adaUserId,
	createdAt: at(60),
}))

export const seedCustomers = (server: FixtureServer) => {
	server.write("customers", orgId, "customer_accounts", accounts)
	server.write("customers", orgId, "customer_channel_links", links)
	server.write("customers", orgId, "customer_notes", notes)
	server.write("customers", orgId, "customer_feature_flags", flags)
}

const fixture: PageFixture = {
	seed: seedCustomers,
	rpcs: {
		"customers.account.detail": () => ({
			account: northwind,
			refs: [ref],
			subscriptions: [subscription],
			upcomingInvoice: null,
			openInvoices: [],
			activeUsersSeries: [],
			contactsToReach: [],
			recentEvents: [],
		}),
		"customers.channel.suggestions": () => ({ items: [] }),
		"customers.account.series": () => ({ series: [] }),
	},
}

export default fixture
