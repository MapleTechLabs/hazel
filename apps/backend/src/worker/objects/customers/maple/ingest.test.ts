/**
 * The Maple mapping against the real `CustomerIngest` and the real compute, in a `CustomersObject`
 * on node SQLite: a day of product events has to land on the Clerk contacts of the Clerk account
 * its `GroupId` names, a group Clerk does not hold has to wait in the unmatched list instead of
 * becoming a customer, a mapped event has to become a metric only Maple may write — and a world
 * where Clerk and Maple are the only sources has to come out with a health score and a
 * `usage_drop` signal when the usage falls away.
 */
import type { IngestOp } from "@hazel/domain/customers"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { runCompute } from "../compute"
import { type CustomersWorld, makeCustomersWorld, NOW } from "../test-kit"
import { addDays, dayOf } from "../time"
import { ORG_ACME, ORG_UNKNOWN, USER_ADA, USER_LIN } from "./fixtures"
import { activityOps, metricDefinitionOps, metricMapOf, metricOps } from "./map"
import type { MapleActivityRow, MapleMetricRow } from "./wire"

const OBSERVED = NOW.toISOString()
const TODAY = dayOf(NOW)
/** The day `usage_drop`'s windows end on: today is still filling in. */
const LAST = addDays(TODAY, -1)

const USERS = [USER_ADA, USER_LIN, "user_3BfrKZlIOPVaRRemgFK2oi4AfSU", "user_3KbIr7YrwhTRq1p9Se5EEgDYiGX"]

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

/** What Clerk established before Maple ever ran: one organization with four members. */
const clerkBefore: ReadonlyArray<IngestOp> = [
	{
		_tag: "account",
		externalId: ORG_ACME,
		name: "Acme Analytics",
		domains: ["acme.com"],
		sameAs: [],
		onNoMatch: "create",
	},
	...USERS.map((externalId, index): IngestOp => ({
		_tag: "contact",
		externalId,
		account: { provider: "clerk", externalId: ORG_ACME },
		email: `member-${index}@acme.com`,
		name: `Member ${index}`,
	})),
]

const activityRow = (day: string, contact: string, events: number): MapleActivityRow => ({
	day,
	account: ORG_ACME,
	contact,
	events,
	sessions: 1,
})

/**
 * A day for each of `count` users, over the 35 days `usage_drop` reads: four of them every day of
 * the 28-day baseline, one of them over the 7 recent days. That is a 75% fall in daily active
 * users, which is the template's worst step.
 */
const DROPPING: ReadonlyArray<MapleActivityRow> = [
	...Array.from({ length: 28 }, (_, index) => addDays(LAST, index - 34)).flatMap((day) =>
		USERS.map((contact) => activityRow(day, contact, 12)),
	),
	...Array.from({ length: 7 }, (_, index) => addDays(LAST, index - 6)).map((day) =>
		activityRow(day, USER_ADA, 3),
	),
]

const accounts = (world: CustomersWorld) =>
	world.rows<{ name: string; activeUsers30d: number; healthStatus: string; healthScore: number | null }>(
		`SELECT name, activeUsers30d, healthStatus, healthScore FROM customer_accounts
		 WHERE deletedAt IS NULL ORDER BY name`,
	)

const refs = (world: CustomersWorld) =>
	world.rows<{ provider: string; externalId: string; entityType: string; matchMethod: string }>(
		`SELECT provider, externalId, entityType, matchMethod FROM customer_external_refs
		 ORDER BY provider, entityType, externalId`,
	)

const unmatched = (world: CustomersWorld) =>
	world.rows<{ provider: string; entityType: string; externalId: string; reason: string }>(
		`SELECT provider, entityType, externalId, reason FROM customer_unmatched_records
		 ORDER BY provider, entityType, externalId`,
	)

const activityDays = (world: CustomersWorld, day: string) =>
	world.rows<{ email: string; eventCount: number; sessionCount: number }>(
		`SELECT c.email, a.eventCount, a.sessionCount FROM customer_activity_daily a
		 JOIN customer_contacts c ON c.id = a.contactId WHERE a.day = ? ORDER BY c.email`,
		day,
	)

const metricRows = (world: CustomersWorld) =>
	world.rows<{ metricKey: string; day: string; value: number }>(
		`SELECT metricKey, day, value FROM customer_metric_daily ORDER BY metricKey, day`,
	)

const signals = (world: CustomersWorld) =>
	world.rows<{ template: string; severity: string; status: string; reason: string }>(
		`SELECT template, severity, status, reason FROM customer_signals ORDER BY template`,
	)

describe("Maple ingest", () => {
	it("records a day of events on the Clerk contacts of the Clerk account", async () => {
		await run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				const mapped = activityOps(
					[activityRow(TODAY, USER_ADA, 26), activityRow(TODAY, USER_LIN, 21)],
					TODAY,
					OBSERVED,
				)
				const report = yield* world.ingest("maple", mapped.ops)

				expect(report.stats.activityDays).toBe(2)
				expect(activityDays(world, TODAY)).toEqual([
					{ email: "member-0@acme.com", eventCount: 26, sessionCount: 1 },
					{ email: "member-1@acme.com", eventCount: 21, sessionCount: 1 },
				])
				// One account, from Clerk; Maple added a reference to it through the shared id.
				expect(accounts(world).map((row) => row.name)).toEqual(["Acme Analytics"])
				expect(refs(world).filter((ref) => ref.provider === "maple")).toEqual([
					{
						provider: "maple",
						externalId: ORG_ACME,
						entityType: "account",
						matchMethod: "shared_id",
					},
				])
				// And no contact of its own beside Clerk's four.
				expect(refs(world).filter((ref) => ref.entityType === "contact")).toHaveLength(4)
			}),
		)
	})

	it("counts a day once however often the overlapping pull re-reads it", async () => {
		await run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				const half = activityOps([activityRow(TODAY, USER_ADA, 12)], TODAY, OBSERVED)
				const whole = activityOps([activityRow(TODAY, USER_ADA, 26)], TODAY, OBSERVED)
				yield* world.ingest("maple", half.ops)
				yield* world.ingest("maple", whole.ops)
				// The day's own re-read, as an hourly pull sends it again.
				const again = yield* world.ingest("maple", whole.ops)

				expect(activityDays(world, TODAY)).toEqual([
					{ email: "member-0@acme.com", eventCount: 26, sessionCount: 1 },
				])
				expect(again.outcomes.filter((outcome) => outcome._tag === "Unchanged")).toHaveLength(2)
			}),
		)
	})

	it("parks a group Clerk does not hold instead of creating a customer for it", async () => {
		await run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				const mapped = activityOps(
					[{ day: TODAY, account: ORG_UNKNOWN, contact: "user_stranger", events: 4, sessions: 2 }],
					TODAY,
					OBSERVED,
				)
				yield* world.ingest("maple", mapped.ops)

				expect(accounts(world).map((row) => row.name)).toEqual(["Acme Analytics"])
				// One record, held by the account reference, so linking it by hand replays the day.
				expect(unmatched(world)).toEqual([
					{
						provider: "maple",
						entityType: "account",
						externalId: ORG_UNKNOWN,
						reason: "No customer matches its ids or domain",
					},
				])
			}),
		)
	})

	it("parks a user the account has no contact for, suggesting the account", async () => {
		await run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				const mapped = activityOps([activityRow(TODAY, "user_notamember", 9)], TODAY, OBSERVED)
				yield* world.ingest("maple", mapped.ops)

				expect(unmatched(world)).toEqual([
					{
						provider: "clerk",
						entityType: "contact",
						externalId: "user_notamember",
						reason: "Activity arrives for this user, but it is not a contact of the customer",
					},
				])
			}),
		)
	})

	it("writes a mapped event as a metric only Maple may write", async () => {
		await run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				const map = metricMapOf([{ event: "dashboard_created", metricKey: "dashboards" }])
				const rows: ReadonlyArray<MapleMetricRow> = [
					{ day: TODAY, account: ORG_ACME, metric: "maple.dashboards", events: 3 },
				]
				yield* world.ingest("maple", [
					...metricDefinitionOps(map),
					...metricOps(rows, map, TODAY, OBSERVED).ops,
				])
				expect(metricRows(world)).toEqual([{ metricKey: "maple.dashboards", day: TODAY, value: 3 }])

				// Re-reading the day replaces its value rather than adding to it.
				yield* world.ingest(
					"maple",
					metricOps(
						[{ day: TODAY, account: ORG_ACME, metric: "maple.dashboards", events: 5 }],
						map,
						TODAY,
						OBSERVED,
					).ops,
				)
				expect(metricRows(world)).toEqual([{ metricKey: "maple.dashboards", day: TODAY, value: 5 }])

				// The namespace is what keeps another source out of it.
				const stolen = yield* world.ingest("autumn", [
					{
						_tag: "metric",
						account: { provider: "clerk", externalId: ORG_ACME },
						metricKey: "maple.dashboards",
						day: TODAY,
						value: 999,
					},
				])
				expect(stolen.outcomes).toEqual([
					{ _tag: "Rejected", message: "maple.dashboards is maple's metric, not autumn's" },
				])
				expect(metricRows(world)[0]?.value).toBe(5)
			}),
		)
	})

	it("computes a health score and opens usage_drop in a Clerk-and-Maple world", async () => {
		await run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				// One page per day, as the pull reads them.
				const days = [...new Set(DROPPING.map((row) => row.day))]
				yield* world.ingest(
					"maple",
					days.flatMap(
						(day) =>
							activityOps(
								DROPPING.filter((row) => row.day === day),
								day,
								OBSERVED,
							).ops,
					),
				)
				yield* world.object.run(runCompute(NOW)).pipe(Effect.orDie)

				const [account] = accounts(world)
				// Usage data is live, so health is scored rather than unknown.
				expect(account?.healthStatus).not.toBe("unknown")
				expect(typeof account?.healthScore).toBe("number")
				expect(account?.activeUsers30d).toBe(4)

				const drop = signals(world).find((signal) => signal.template === "usage_drop")
				expect(drop).toMatchObject({ status: "open", severity: "high" })
				expect(drop?.reason).toMatch(/Daily active users down 75%/)

				// The inactive template needs no activity at all for 14 days; one user still shows up.
				expect(signals(world).map((signal) => signal.template)).not.toContain("inactive")
			}),
		)
	})
})
