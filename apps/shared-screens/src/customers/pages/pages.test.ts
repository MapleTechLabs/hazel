// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import type * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { Navigate } from "../../app/requests"
import type { Session } from "../../app/session"
import { OverviewMessage, OverviewPageNoDeps } from "./OverviewPage"
import { SupportReportPageNoDeps } from "./support/SupportReportPage"

/** The Customers overview (`/:org/customers`) and the Support report (`/:org/customers/support`). */

const orgId = OrganizationId.make("00000001-0000-4000-8000-000000000001")
const kestrel = CustomerAccountId.make("00000010-0000-4000-8000-000000000001")

const session: Session = {
	auth: "SignedIn",
	user: {
		id: UserId.make("00000002-0000-4000-8000-000000000001"),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: orgId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: OrganizationMemberId.make("00000003-0000-4000-8000-000000000001"), role: "owner" },
	orgSlug: "hazel",
}

const byProp = (tag: string, name: string, value: string): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const tile = (label: string) => byProp("statTile", "label", label)

const stats = (count: number, medianMs: number | null, withinPct: number | null) => ({
	count,
	medianMs,
	p90Ms: medianMs === null ? null : medianMs * 4,
	withinPct,
})

const report: Customers.SupportReport = {
	issues: 64,
	firstResponse: stats(58, 47 * 60_000, 0.86),
	resolution: stats(49, 9 * 3_600_000, 0.78),
	breaches: 11,
	overdueNow: 1,
	byAccount: [
		{
			key: kestrel,
			label: "Kestrel Systems",
			issues: 14,
			firstResponse: stats(13, 88 * 60_000, 0.69),
			resolution: stats(10, 840 * 60_000, 0.6),
			breaches: 5,
		},
	],
	byPolicy: [
		{
			key: "Standard",
			label: "Standard",
			issues: 50,
			firstResponse: stats(45, 52 * 60_000, 0.84),
			resolution: stats(38, 600 * 60_000, 0.76),
			breaches: 9,
		},
	],
	daily: [
		{ day: "2026-11-09", issues: 2, firstResponseMedianMs: 30 * 60_000, withinPct: 1 },
		{ day: "2026-11-10", issues: 1, firstResponseMedianMs: null, withinPct: null },
	],
}

const emptyReport: Customers.SupportReport = {
	...report,
	issues: 0,
	overdueNow: 0,
	breaches: 0,
	byAccount: [],
	byPolicy: [],
}

describe("support report page", () => {
	const start = () => Scene.start(SupportReportPageNoDeps, { session, isMobile: false })

	test("loads the last 30 days into six tiles, the daily chart and both tables", () => {
		const s = start().loaded("report", report)
		expect(s.get(tile("Median first response")).props).toMatchObject({
			value: "47m",
			detail: "58 answered",
		})
		expect(s.get(tile("Breaches")).props).toMatchObject({ value: "11", detail: "1 overdue now" })
		expect(s.get(Locator.tag("hz:chart")).props).toMatchObject({
			kind: "stackedBar",
			format: "duration",
			labels: ["Nov 9", "Nov 10"],
		})
		s.expect(byProp("tableRow", "title", "Kestrel Systems"))
			.toExist()
			.expect(byProp("tableRow", "title", "Standard"))
			.toExist()
	})

	test("the chart switches to the share within SLA", () => {
		const s = start()
			.loaded("report", report)
			.fire(byProp("choiceGroup", "label", "Chart"), "change", { selected: ["within"] })
		expect(s.get(Locator.tag("hz:chart")).props).toMatchObject({ format: "percent" })
	})

	test("an account row opens the customer; SLA settings opens its page", () => {
		start()
			.loaded("report", report)
			.fire(byProp("tableRow", "title", "Kestrel Systems"), "press")
			.expectExact(Navigate.make({ href: `/hazel/customers/${kestrel}`, replace: false }))
			.resolve(Navigate, Component.noop)
			.fire(byProp("button", "label", "SLA settings"), "press")
			.expectExact(Navigate.make({ href: "/hazel/customers/settings/sla", replace: false }))
			.resolve(Navigate, Component.noop)
	})

	test("an empty range is the empty state; a failure offers a retry", () => {
		start()
			.loaded("report", emptyReport)
			.expect(byProp("emptyState", "title", "No support issues in this range"))
			.toExist()
		start()
			.loadFailed("report", "Offline")
			.expect(byProp("emptyState", "title", "Couldn't load the Support report"))
			.toExist()
			.fire(byProp("button", "label", "Try again"), "press")
			.expect(byProp("emptyState", "title", "Couldn't load the Support report"))
			.toBeAbsent()
	})
})

const kpi = (value: number, previous: number) => ({
	value,
	previous,
	deltaPct: Math.round(((value - previous) / previous) * 1000) / 10,
})

const overview: Customers.OverviewResult = {
	range: "30d",
	currency: "USD",
	bucket: "day",
	kpis: {
		mrrMinor: kpi(4_821_000, 4_539_600),
		payingCustomers: kpi(176, 171),
		activeCustomers: kpi(168, 168),
		wau: kpi(978, 951),
		mau: kpi(1_611, 1_602),
		revenueMinor: kpi(5_310_400, 4_987_200),
		logoChurn: { value: 3, previous: 2, deltaPct: 50 },
		atRiskMrrMinor: kpi(545_000, 612_000),
		nrrPct: null,
	},
	mrrMovements: [],
	activeUsers: [],
	topMovers: { gainers: [], decliners: [] },
	recentChurn: [],
	recentNew: [],
	newTrials: [],
	hasData: { activity: true, billing: true },
}

describe("overview page", () => {
	const start = () =>
		Scene.start(OverviewPageNoDeps, { session, isMobile: false, nowMs: Date.UTC(2026, 10, 10, 12) })
			.loaded("overview", overview)
			.loaded("support", report)
			.loaded("suggestions", [])
	const PROVIDERS = `providers:"${orgId}"`

	test("draws the three headline numbers with their change", () => {
		const s = start().subscription(PROVIDERS, OverviewMessage.UpdatedProviders({ providers: ["stripe"] }))
		expect(s.get(tile("MRR")).props).toMatchObject({ value: "$48,210", delta: "+6.2%", trend: "up" })
		expect(s.get(tile("MRR at risk")).props).toMatchObject({ value: "$5,450", comparison: "11% of MRR" })
		s.fire(Locator.tag("hz:toggle"), "change", { checked: false })
		expect(s.get(tile("MRR")).props?.["delta"]).toBeUndefined()
	})

	test("with nothing connected, the setup cards replace the dashboard", () => {
		start()
			.subscription(PROVIDERS, OverviewMessage.UpdatedProviders({ providers: [] }))
			.expect(byProp("button", "label", "Connect"))
			.toExist()
			.expect(tile("MRR"))
			.toBeAbsent()
	})

	test("an empty queue says so", () => {
		start()
			.subscription(PROVIDERS, OverviewMessage.UpdatedProviders({ providers: ["stripe"] }))
			.subscription(`signals:"${orgId}"`, OverviewMessage.UpdatedSignals({ signals: [] }))
			.subscription(`accounts:"${orgId}"`, OverviewMessage.UpdatedAccounts({ accounts: [] }))
			.expect(byProp("emptyState", "title", "All clear: no open signals."))
			.toExist()
	})
})
