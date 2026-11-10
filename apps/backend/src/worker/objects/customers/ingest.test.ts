/**
 * `CustomerIngest` in a `CustomersObject` on node SQLite: identity matching in order, idempotent
 * replays, field precedence, unmatched records and their replay, billing and usage writes.
 */
import type { IngestOp, UpsertAccount } from "@hazel/domain/customers"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { CustomerIngest } from "./ingest"
import { type CustomersWorld, makeCustomersWorld } from "./test-kit"
import { dayOf } from "./time"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const clerkOrg = (id: string, name: string, domains: Array<string> = [`${id}.com`]): UpsertAccount => ({
	_tag: "account",
	externalId: id,
	name,
	domains,
	sameAs: [],
	onNoMatch: "create",
})

const stripeCustomer = (id: string, fields: Partial<UpsertAccount>): UpsertAccount => ({
	_tag: "account",
	externalId: id,
	sameAs: [],
	onNoMatch: "unmatched",
	...fields,
})

const accounts = (world: CustomersWorld) =>
	world.rows<{ id: string; name: string; domains: string; fieldSources: string }>(
		`SELECT id, name, domains, fieldSources FROM customer_accounts WHERE deletedAt IS NULL ORDER BY name`,
	)

const refsOf = (world: CustomersWorld, accountId: string) =>
	world.rows<{ provider: string; externalId: string; matchMethod: string }>(
		`SELECT provider, externalId, matchMethod FROM customer_external_refs WHERE accountId = ? AND entityType = 'account' ORDER BY provider`,
		accountId,
	)

const changes = (world: CustomersWorld) =>
	world.rows<{ n: number }>(`SELECT count(*) AS n FROM _changes`)[0]!.n

const today = dayOf(new Date())

describe("CustomerIngest", () => {
	it("matches accounts by ref, shared id, then domain; parks the rest", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const created = yield* world.ingest("clerk", [
					clerkOrg("org_1", "Acme", ["acme.com"]),
					clerkOrg("org_2", "Globex", ["globex.io"]),
					// Same domain as Acme: a Clerk org never merges by domain.
					clerkOrg("org_3", "Acme EU", ["https://www.acme.com/eu"]),
				])
				expect(created.outcomes.map((outcome: { _tag: string }) => outcome._tag)).toEqual([
					"Created",
					"Created",
					"Created",
				])
				const [acme] = accounts(world)
				expect(JSON.parse(acme!.domains)).toEqual(["acme.com"])

				const report = yield* world.ingest("stripe", [
					// Shared id (metadata.clerk_org_id).
					stripeCustomer("cus_1", {
						name: "Acme Inc",
						sameAs: [{ provider: "clerk", externalId: "org_1" }],
					}),
					// Domain, unique.
					stripeCustomer("cus_2", { name: "Globex LLC", domains: ["globex.io"] }),
					// Domain, ambiguous (two Acmes).
					stripeCustomer("cus_3", { name: "Acme Holding", domains: ["acme.com"] }),
					// Nothing.
					stripeCustomer("cus_4", { name: "Initech", domains: ["initech.com"] }),
					// Free mail never matches.
					stripeCustomer("cus_5", { name: "Bob", domains: ["gmail.com"] }),
				])
				expect(report.outcomes.map((outcome: { _tag: string }) => outcome._tag)).toEqual([
					"Updated",
					"Updated",
					"Unmatched",
					"Unmatched",
					"Unmatched",
				])
				expect(report.stats).toMatchObject({ accounts: 2, unmatched: 3 })
				const acmeId = world.rows<{ id: string }>(
					`SELECT id FROM customer_accounts WHERE name = 'Acme'`,
				)[0]!.id
				expect(refsOf(world, acmeId)).toEqual([
					{ provider: "clerk", externalId: "org_1", matchMethod: "created" },
					{ provider: "stripe", externalId: "cus_1", matchMethod: "shared_id" },
				])
				// Clerk set the name first: Stripe's does not win.
				expect(accounts(world).map((account) => account.name)).toEqual(["Acme", "Acme EU", "Globex"])
				const unmatched = world.rows<{
					externalId: string
					reason: string
					suggestedAccountId: string | null
					confidence: number | null
				}>(
					`SELECT externalId, reason, suggestedAccountId, confidence FROM customer_unmatched_records ORDER BY externalId`,
				)
				expect(unmatched).toMatchObject([
					{ externalId: "cus_3", reason: "2 customers share the domain acme.com", confidence: 0.5 },
					{
						externalId: "cus_4",
						reason: "No customer matches its ids or domain",
						suggestedAccountId: null,
					},
					{ externalId: "cus_5" },
				])
				expect(unmatched[0]!.suggestedAccountId).not.toBeNull()
			}),
		))

	it("is idempotent: a replay changes nothing and writes no change rows", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const ops: Array<IngestOp> = [
					clerkOrg("org_1", "Acme"),
					{
						_tag: "contact",
						externalId: "user_1",
						account: { provider: "clerk", externalId: "org_1" },
						email: "ann@org_1.com",
						name: "Ann",
						role: "org:admin",
					},
					{
						_tag: "activity",
						contact: { provider: "clerk", externalId: "user_1" },
						account: { provider: "clerk", externalId: "org_1" },
						day: today,
						eventCount: 12,
						signedIn: true,
					},
				]
				const first = yield* world.ingest("clerk", ops)
				expect(first.outcomes.map((outcome: { _tag: string }) => outcome._tag)).toEqual([
					"Created",
					"Created",
					"Created",
				])
				const before = changes(world)
				const second = yield* world.ingest("clerk", ops)
				expect(second.outcomes.map((outcome: { _tag: string }) => outcome._tag)).toEqual([
					"Unchanged",
					"Unchanged",
					"Unchanged",
				])
				expect(changes(world)).toBe(before)
				// The contact joined (once) and was first active today (once).
				expect(
					world
						.rows<{ type: string }>(`SELECT type FROM customer_events ORDER BY type`)
						.map((row) => row.type),
				).toEqual(["contact.first_active", "contact.joined"])
			}),
		))

	it("applies field precedence: Clerk over Stripe for names, a manual edit over every source", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("stripe", [
					stripeCustomer("cus_1", {
						name: "ACME CORP",
						domains: ["acme.com"],
						onNoMatch: "create",
					}),
				])
				yield* world.ingest("clerk", [
					{ ...clerkOrg("org_1", "Acme"), sameAs: [{ provider: "stripe", externalId: "cus_1" }] },
				])
				expect(accounts(world).map((account) => account.name)).toEqual(["Acme"])
				yield* world.ingest("stripe", [
					stripeCustomer("cus_1", { name: "ACME CORPORATION", onNoMatch: "create" }),
				])
				expect(accounts(world).map((account) => account.name)).toEqual(["Acme"])
				const accountId = accounts(world)[0]!.id
				const updated = yield* world.call(
					"customers.account.update",
					{ accountId, name: "Acme (key account)" },
					world.member,
				)
				expect(updated._tag).toBe("Success")
				yield* world.ingest("clerk", [clerkOrg("org_1", "Acme Renamed")])
				expect(accounts(world).map((account) => account.name)).toEqual(["Acme (key account)"])
				expect(JSON.parse(accounts(world)[0]!.fieldSources)).toMatchObject({ name: "hazel" })
			}),
		))

	it("parks billing for unknown customers and replays it once linked", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [clerkOrg("org_1", "Acme")])
				const accountId = accounts(world)[0]!.id
				const subscription: IngestOp = {
					_tag: "subscription",
					externalId: "sub_1",
					account: { provider: "stripe", externalId: "cus_9" },
					planName: "Team",
					status: "active",
					mrrMinor: 19_900,
					currency: "USD",
					interval: "month",
					quantity: 1,
					startedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
					trialEndsAt: null,
					currentPeriodEnd: null,
					cancelAtPeriodEnd: false,
					canceledAt: null,
				}
				const report = yield* world.ingest("stripe", [
					stripeCustomer("cus_9", { name: "Mystery Co", domains: ["mystery.dev"] }),
					subscription,
				])
				expect(report.outcomes.map((outcome: { _tag: string }) => outcome._tag)).toEqual([
					"Unmatched",
					"Unmatched",
				])
				const record = world.rows<{ id: string }>(
					`SELECT id FROM customer_unmatched_records WHERE entityType = 'account'`,
				)[0]!
				const linked = yield* world.call(
					"customers.unmatched.link",
					{ recordId: record.id, accountId },
					world.owner,
				)
				expect(linked._tag).toBe("Success")
				expect(refsOf(world, accountId).map((ref) => `${ref.provider}:${ref.matchMethod}`)).toEqual([
					"clerk:created",
					"stripe:manual",
				])
				// Both records resolved; the subscription landed on the account.
				expect(world.rows(`SELECT status FROM customer_unmatched_records`)).toEqual([
					{ status: "linked" },
					{ status: "linked" },
				])
				expect(world.rows(`SELECT accountId, currency FROM customer_subscriptions`)).toEqual([
					{ accountId, currency: "usd" },
				])
				// A member may not link.
				const again = yield* world.call(
					"customers.unmatched.link",
					{ recordId: record.id, accountId },
					world.member,
				)
				expect(again._tag).toBe("Failure")
			}),
		))

	it("resolves a parked usage record once its customer appears; ignore rules skip records", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const usage: IngestOp = {
					_tag: "activity",
					contact: { provider: "clerk", externalId: "user_1" },
					account: { provider: "clerk", externalId: "org_1" },
					day: today,
					eventCount: 5,
				}
				const parked = yield* world.ingest("maple", [usage, usage])
				expect(parked.outcomes[0]._tag).toBe("Unmatched")
				expect(
					world.rows(
						`SELECT provider, entityType, externalId, eventCount30d, status FROM customer_unmatched_records`,
					),
				).toEqual([
					{
						provider: "clerk",
						entityType: "account",
						externalId: "org_1",
						eventCount30d: 10,
						status: "open",
					},
				])
				yield* world.ingest("clerk", [clerkOrg("org_1", "Acme")])
				expect(world.rows(`SELECT status FROM customer_unmatched_records`)).toEqual([
					{ status: "linked" },
				])

				const ignored = world.rows<{ id: string }>(`SELECT id FROM customer_unmatched_records`)[0]!
				yield* world.ingest("stripe", [
					stripeCustomer("cus_test", { name: "Test org", domains: ["example.test"] }),
				])
				const record = world.rows<{ id: string }>(
					`SELECT id FROM customer_unmatched_records WHERE externalId = 'cus_test'`,
				)[0]!
				expect(ignored.id).not.toBe(record.id)
				const ignore = yield* world.call(
					"customers.unmatched.ignore",
					{ recordId: record.id, rule: { field: "domain", pattern: "*.test" } },
					world.owner,
				)
				expect(ignore._tag).toBe("Success")
				const next = yield* world.ingest("stripe", [
					stripeCustomer("cus_test2", { name: "QA", domains: ["qa.test"] }),
				])
				expect(next.outcomes[0]._tag).toBe("Ignored")
			}),
		))

	it("records billing events, refuses built-in metrics, and marks a disconnected source stale", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [clerkOrg("org_1", "Acme")])
				const accountRef = { provider: "clerk" as const, externalId: "org_1" }
				const sub: IngestOp = {
					_tag: "subscription",
					externalId: "sub_1",
					account: accountRef,
					planName: "Starter",
					status: "active",
					mrrMinor: 4_900,
					currency: "usd",
					interval: "month",
					quantity: 1,
					startedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
					trialEndsAt: null,
					currentPeriodEnd: null,
					cancelAtPeriodEnd: false,
					canceledAt: null,
				}
				yield* world.ingest("autumn", [sub])
				yield* world.ingest("autumn", [{ ...sub, planName: "Team", mrrMinor: 19_900 }])
				yield* world.ingest("autumn", [
					{ ...sub, planName: "Team", mrrMinor: 19_900, cancelAtPeriodEnd: true },
				])
				yield* world.ingest("stripe", [
					{
						_tag: "invoice",
						externalId: "in_1",
						account: accountRef,
						subscriptionExternalId: "sub_1",
						number: "INV-1",
						status: "open",
						amountDueMinor: 19_900,
						amountPaidMinor: 0,
						currency: "usd",
						issuedAt: new Date().toISOString(),
						dueAt: new Date().toISOString(),
						paidAt: null,
						attemptCount: 2,
						declineReason: "card_declined",
					},
				])
				expect(
					world
						.rows<{ type: string }>(`SELECT type FROM customer_events ORDER BY type`)
						.map((row) => row.type),
				).toEqual([
					"invoice.payment_failed",
					"subscription.cancel_scheduled",
					"subscription.plan_changed",
					"subscription.started",
				])
				// The invoice is linked to the Autumn subscription by its external id.
				expect(
					world.rows(
						`SELECT count(*) AS n FROM customer_invoices WHERE subscriptionId IS NOT NULL`,
					),
				).toEqual([{ n: 1 }])

				const refused = yield* world.object
					.run(
						Effect.gen(function* () {
							const ingest = yield* CustomerIngest
							return yield* ingest.apply(
								{
									connectionId: world.connection("autumn"),
									provider: "autumn",
									runId: null,
									trigger: "manual",
								},
								[
									{
										_tag: "metric",
										account: accountRef,
										metricKey: "mrr",
										day: today,
										value: 1,
									},
								],
							)
						}).pipe(Effect.provide(CustomerIngest.layer)),
					)
					.pipe(Effect.flip)
				expect(refused._tag).toBe("CustomerIngestRejectedError")

				const disconnected = yield* world.call(
					"customers.connection.disconnect",
					{ connectionId: world.connection("clerk") },
					world.owner,
				)
				expect(disconnected._tag).toBe("Success")
				expect(
					world.rows(`SELECT provider, staleAt IS NOT NULL AS stale FROM customer_external_refs`),
				).toEqual([{ provider: "clerk", stale: 1 }])
				expect(accounts(world)).toHaveLength(1)
			}),
		))
})
