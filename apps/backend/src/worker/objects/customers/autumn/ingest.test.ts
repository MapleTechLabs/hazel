/**
 * The Autumn mapping against the real `CustomerIngest` and the real compute, in a `CustomersObject`
 * on node SQLite: a customer has to land on the account its own id names (the Clerk organization
 * id), its plan has to resolve the account through the refs, its feature usage has to become a
 * metric with a plan limit the `near_limit` signal opens on, and — once Autumn's backfill has
 * finished — Autumn's subscriptions, not Stripe's, have to be the account's MRR.
 */
import type { IngestOp } from "@hazel/domain/customers"
import { Effect, Schema, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { runCompute } from "../compute"
import { type CustomersWorld, makeCustomersWorld, NOW } from "../test-kit"
import { dayOf } from "../time"
import {
	CUSTOMER_ACME,
	CUSTOMER_GLOBEX,
	CUSTOMER_PERSONAL,
	FEATURES,
	ORG_ACME,
	ORG_GLOBEX,
	PLAN_ENTERPRISE,
	PLAN_FREE,
	PLAN_PRO,
	SUB_ACME,
	SUB_ACME_EXPIRED,
	SUB_GLOBEX_TRIAL,
} from "./fixtures"
import { customerOps, featureDefinitionOps, plansById, subscriptionOp } from "./map"
import { AutumnCustomer, AutumnPlan, AutumnSubscription } from "./wire"

const CONFIG = { _tag: "autumn", customerIdIsClerkOrgId: true } as const

const customer = Schema.decodeUnknownSync(AutumnCustomer)
const subscription = Schema.decodeUnknownSync(AutumnSubscription)
const plan = Schema.decodeUnknownSync(AutumnPlan)

const PLANS = plansById([PLAN_PRO, PLAN_ENTERPRISE, PLAN_FREE].map((row) => plan(row)))
const OBSERVED = NOW.toISOString()
const TODAY = dayOf(NOW)

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const named = (row: unknown) => {
	const decoded = customer(row)
	return { ...decoded, id: decoded.id ?? "" }
}

/** What Clerk established before Autumn ever ran: two organizations and a member each. */
const clerkBefore: ReadonlyArray<IngestOp> = [
	{
		_tag: "account",
		externalId: ORG_ACME,
		name: "Acme Analytics",
		domains: ["acme.com"],
		seatsUsed: 9,
		sameAs: [],
		onNoMatch: "create",
	},
	{
		_tag: "contact",
		externalId: "user_2ada000000000000000000",
		account: { provider: "clerk", externalId: ORG_ACME },
		email: "ada@acme.com",
		name: "Ada Lovelace",
	},
	{ _tag: "account", externalId: ORG_GLOBEX, name: "Globex", sameAs: [], onNoMatch: "create" },
]

/** A whole Autumn backfill of the fixture organization, in the order the pull produces it. */
const backfill: ReadonlyArray<IngestOp> = [
	...featureDefinitionOps(FEATURES),
	...[CUSTOMER_ACME, CUSTOMER_GLOBEX, CUSTOMER_PERSONAL].flatMap((row) =>
		customerOps(named(row), { config: CONFIG, env: "live", at: NOW, observedAt: OBSERVED }),
	),
	...[SUB_ACME_EXPIRED, SUB_ACME, SUB_GLOBEX_TRIAL].flatMap((row) => {
		const op = subscriptionOp(subscription(row), {
			plans: PLANS,
			currency: "usd",
			observedAt: OBSERVED,
		})
		return op === null ? [] : [op]
	}),
]

const accounts = (world: CustomersWorld) =>
	world.rows<{
		name: string
		domains: string
		planName: string | null
		mrrMinor: number
		seatsUsed: number | null
		seatsLimit: number | null
		lifecycleStage: string
	}>(
		`SELECT name, domains, planName, mrrMinor, seatsUsed, seatsLimit, lifecycleStage
		 FROM customer_accounts WHERE deletedAt IS NULL ORDER BY name`,
	)

const refs = (world: CustomersWorld) =>
	world.rows<{ provider: string; externalId: string; entityType: string; matchMethod: string }>(
		`SELECT provider, externalId, entityType, matchMethod FROM customer_external_refs ORDER BY provider, externalId`,
	)

const subscriptions = (world: CustomersWorld) =>
	world.rows<{ provider: string; planName: string | null; status: string; mrrMinor: number }>(
		`SELECT provider, planName, status, mrrMinor FROM customer_subscriptions ORDER BY provider, mrrMinor DESC`,
	)

const metrics = (world: CustomersWorld, account = "Acme Analytics") =>
	world.rows<{ metricKey: string; value: number; limitValue: number | null }>(
		`SELECT m.metricKey, m.value, m.limitValue FROM customer_metric_daily m
		 JOIN customer_accounts a ON a.id = m.accountId
		 WHERE m.day = ? AND a.name = ? ORDER BY m.metricKey`,
		TODAY,
		account,
	)

const definitions = (world: CustomersWorld) =>
	world.rows<{ key: string; name: string; provider: string | null; aggregation: string }>(
		`SELECT key, name, provider, aggregation FROM customer_metric_definitions
		 WHERE provider IS NOT NULL ORDER BY key`,
	)

const unmatched = (world: CustomersWorld) =>
	world.rows<{ entityType: string; externalId: string; reason: string }>(
		`SELECT entityType, externalId, reason FROM customer_unmatched_records WHERE status = 'open' ORDER BY externalId`,
	)

const signals = (world: CustomersWorld) =>
	world.rows<{ template: string; status: string; reason: string; evidence: string }>(
		`SELECT r.template, s.status, s.reason, s.evidence FROM customer_signals s
		 JOIN customer_signal_rules r ON r.id = s.ruleId
		 WHERE s.status = 'open' ORDER BY r.template`,
	)

/** The connection has finished its first import: from here Autumn owns the MRR. */
const markBackfilled = (world: CustomersWorld, provider: "autumn" | "stripe") =>
	world.object.storage.db
		.prepare(`UPDATE customer_connections SET backfilledAt = ?, status = 'active' WHERE provider = ?`)
		.run(NOW.toISOString(), provider)

describe("Autumn ops through CustomerIngest", () => {
	it("lands the plans and the usage on the account its customer id names", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				const report = yield* world.ingest("autumn", backfill)

				// Both customers matched by the shared id their own id is; the personal one did not.
				expect(refs(world).filter((ref) => ref.provider === "autumn")).toEqual([
					{
						provider: "autumn",
						externalId: ORG_ACME,
						entityType: "account",
						matchMethod: "shared_id",
					},
					{
						provider: "autumn",
						externalId: ORG_GLOBEX,
						entityType: "account",
						matchMethod: "shared_id",
					},
				])
				expect(unmatched(world)).toEqual([
					{
						entityType: "account",
						externalId: CUSTOMER_PERSONAL.id,
						reason: "No customer matches its ids or domain",
					},
				])

				// Autumn's seat pool outranks Clerk's member count.
				expect(accounts(world)).toMatchObject([
					{ name: "Acme Analytics", seatsUsed: 12, seatsLimit: 25 },
					{ name: "Globex", seatsUsed: null, seatsLimit: null },
				])

				// The live plans and the one that ended.
				expect(subscriptions(world)).toEqual([
					{ provider: "autumn", planName: "Enterprise", status: "trialing", mrrMinor: 300_000 },
					{ provider: "autumn", planName: "Pro", status: "active", mrrMinor: 9_900 },
					{ provider: "autumn", planName: "Free", status: "canceled", mrrMinor: 0 },
				])

				// A metric per metered feature, named after the feature and owned by Autumn.
				expect(definitions(world)).toEqual([
					{
						key: "autumn.messages",
						name: "Messages",
						provider: "autumn",
						aggregation: "max",
					},
					{ key: "autumn.seats", name: "Seats", provider: "autumn", aggregation: "max" },
				])
				expect(metrics(world)).toEqual([
					{ metricKey: "autumn.messages", value: 8_200, limitValue: 10_000 },
					{ metricKey: "autumn.seats", value: 12, limitValue: 25 },
				])
				// An unlimited feature has no limit to be near.
				expect(metrics(world, "Globex")).toEqual([
					{ metricKey: "autumn.messages", value: 1_000, limitValue: null },
				])
				expect(report.stats).toMatchObject({ accounts: 2, subscriptions: 3, unmatched: 1 })
				expect(report.stats.rejected ?? 0).toBe(0)

				// A redelivery of the whole backfill writes nothing new: the personal customer stays
				// parked (one unmatched record, not a second), everything else is unchanged.
				const again = yield* world.ingest("autumn", backfill)
				expect(new Set(again.outcomes.map((outcome) => outcome._tag))).toEqual(
					new Set(["Unchanged", "Unmatched"]),
				)
				expect(unmatched(world)).toHaveLength(1)
				expect(accounts(world)).toHaveLength(2)
			}),
		))

	it("opens a near-limit signal on the feature closest to its plan limit", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				yield* world.ingest("autumn", backfill)
				markBackfilled(world, "autumn")
				yield* world.object.run(runCompute(NOW)).pipe(Effect.orDie)

				const nearLimit = signals(world).find((signal) => signal.template === "near_limit")
				// 8 200 of 10 000 messages is 82%: below the default 90% threshold.
				expect(nearLimit).toBeUndefined()

				// Usage climbs past the threshold; the next compute opens the signal.
				yield* world.ingest("autumn", [
					{
						_tag: "metric",
						account: { provider: "autumn", externalId: ORG_ACME },
						metricKey: "autumn.messages",
						day: TODAY,
						value: 9_600,
						limitValue: 10_000,
					},
				])
				yield* world.object.run(runCompute(NOW)).pipe(Effect.orDie)

				const opened = signals(world).find((signal) => signal.template === "near_limit")
				expect(opened?.reason).toBe("Messages at 96% of the plan limit (9600 of 10000)")
				expect(JSON.parse(opened?.evidence ?? "{}")).toMatchObject({
					_tag: "limit",
					metricKey: "autumn.messages",
					metricName: "Messages",
					value: 9_600,
					limit: 10_000,
					pct: 96,
				})
			}),
		))

	it("takes Autumn's subscriptions for the MRR once its backfill has finished, Stripe's before", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				// Stripe got there first, with a different amount for the same customer.
				yield* world.ingest("stripe", [
					{
						_tag: "account",
						externalId: "cus_2acme0000000001",
						sameAs: [{ provider: "clerk", externalId: ORG_ACME }],
						onNoMatch: "unmatched",
					},
					{
						_tag: "subscription",
						externalId: "sub_2acme0000000001",
						account: { provider: "stripe", externalId: "cus_2acme0000000001" },
						planName: "Pro (Stripe)",
						status: "active",
						mrrMinor: 4_200,
						currency: "usd",
						interval: "month",
						quantity: 1,
						startedAt: "2026-01-14T09:20:00.000Z",
						trialEndsAt: null,
						currentPeriodEnd: "2026-12-01T09:20:00.000Z",
						cancelAtPeriodEnd: false,
						canceledAt: null,
					},
				])
				markBackfilled(world, "stripe")
				yield* world.object.run(runCompute(NOW)).pipe(Effect.orDie)
				const beforeAutumn = accounts(world).find((row) => row.name === "Acme Analytics")
				expect(beforeAutumn).toMatchObject({ planName: "Pro (Stripe)", mrrMinor: 4_200 })

				// Autumn's data arrives; while its backfill is unfinished Stripe still owns the MRR.
				yield* world.ingest("autumn", backfill)
				yield* world.object.run(runCompute(NOW)).pipe(Effect.orDie)
				expect(accounts(world).find((row) => row.name === "Acme Analytics")).toMatchObject({
					planName: "Pro (Stripe)",
					mrrMinor: 4_200,
				})

				// Once it has, Autumn is the billing source and Stripe's subscriptions step aside.
				markBackfilled(world, "autumn")
				yield* world.object.run(runCompute(NOW)).pipe(Effect.orDie)
				expect(accounts(world).find((row) => row.name === "Acme Analytics")).toMatchObject({
					planName: "Pro",
					mrrMinor: 9_900,
					lifecycleStage: "active",
				})
			}),
		))
})
