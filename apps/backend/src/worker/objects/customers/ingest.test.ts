/**
 * `CustomerIngest` in a `CustomersObject` on node SQLite: identity matching in order, idempotent
 * replays, field precedence, unmatched records and their replay, billing and usage writes.
 */
import type { IngestOp, RefEntityType, UpsertAccount, UpsertContact } from "@hazel/domain/customers"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { CustomerIngest } from "./ingest"
import { normalizeDomain } from "./ingest-live"
import { type CustomersWorld, makeCustomersWorld, NOW, TODAY } from "./test-kit"

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
	matchByDomain: true,
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

const today = TODAY

const member = (id: string, org: string, fields: Partial<UpsertContact> = {}): UpsertContact => ({
	_tag: "contact",
	externalId: id,
	account: { provider: "clerk", externalId: org },
	email: `${id}@${org}.com`,
	name: id,
	...fields,
})

const outcomeTags = (report: { outcomes: ReadonlyArray<{ _tag: string }> }) =>
	report.outcomes.map((outcome) => outcome._tag)

const sweep = (
	world: CustomersWorld,
	provider: "clerk" | "stripe",
	since: Date,
	entityTypes: ReadonlyArray<RefEntityType>,
) =>
	world.object.run(
		Effect.gen(function* () {
			const ingest = yield* CustomerIngest
			yield* ingest.completeSweep(world.connection(provider), since, entityTypes)
		}).pipe(Effect.provide(CustomerIngest.layer)),
	)

const liveContacts = (world: CustomersWorld) =>
	world
		.rows<{ name: string }>(`SELECT name FROM customer_contacts WHERE deletedAt IS NULL ORDER BY name`)
		.map((row) => row.name)

/** When the provider deleted the records of the ordering tests. */
const DELETED_AT = NOW
const isoAt = (offsetMs: number) => new Date(DELETED_AT.getTime() + offsetMs).toISOString()

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
					startedAt: new Date(NOW.getTime() - 40 * 86_400_000).toISOString(),
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

	it("records billing events, refuses built-in metrics, and keeps a disconnected source's data", () =>
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
					startedAt: new Date(NOW.getTime() - 60 * 86_400_000).toISOString(),
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
						issuedAt: NOW.toISOString(),
						dueAt: NOW.toISOString(),
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
					.pipe(Effect.orDie)
				expect(outcomeTags(refused)).toEqual(["Rejected"])
				expect(refused.stats.rejected).toBe(1)

				const disconnected = yield* world.call(
					"customers.connection.disconnect",
					{ connectionId: world.connection("clerk") },
					world.owner,
				)
				expect(disconnected._tag).toBe("Success")
				expect(
					world.rows(`SELECT provider, staleAt IS NOT NULL AS stale FROM customer_external_refs`),
				).toEqual([{ provider: "clerk", stale: 0 }])
				expect(accounts(world)).toHaveLength(1)
			}),
		))

	it("removes on a full sweep the records it did not see", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [
					clerkOrg("org_1", "Acme"),
					clerkOrg("org_2", "Globex"),
					clerkOrg("org_3", "Initech"),
					member("ann", "org_1"),
					member("bob", "org_1"),
				])
				// Globex is also a Stripe customer: its Stripe ref keeps it.
				yield* world.ingest("stripe", [
					stripeCustomer("cus_2", { sameAs: [{ provider: "clerk", externalId: "org_2" }] }),
				])
				// Everything was last seen long ago; Initech's ref a person linked (sweeps keep it).
				world.object.storage.db
					.prepare(`UPDATE customer_external_refs SET lastSyncedAt = '2000-01-01 00:00:00.000'`)
					.run()
				world.object.storage.db
					.prepare(
						`UPDATE customer_external_refs SET matchMethod = 'manual' WHERE externalId = 'org_3'`,
					)
					.run()
				const since = new Date("2001-01-01T00:00:00.000Z")
				// The sweep lists Acme and Ann only.
				yield* world.ingest("clerk", [clerkOrg("org_1", "Acme"), member("ann", "org_1")])
				yield* sweep(world, "clerk", since, ["account", "contact"])

				expect(accounts(world).map((account) => account.name)).toEqual(["Acme", "Globex", "Initech"])
				expect(
					world.rows(
						`SELECT externalId, staleAt IS NOT NULL AS stale FROM customer_external_refs WHERE entityType = 'account' ORDER BY externalId`,
					),
				).toEqual([
					{ externalId: "cus_2", stale: 0 },
					{ externalId: "org_1", stale: 0 },
					{ externalId: "org_2", stale: 1 },
					{ externalId: "org_3", stale: 0 },
				])
				expect(liveContacts(world)).toEqual(["ann"])
				const removed = () =>
					world.rows(`SELECT title FROM customer_events WHERE type = 'contact.removed'`)
				expect(removed()).toEqual([{ title: "bob left" }])

				// A second sweep finds nothing new to remove.
				yield* sweep(world, "clerk", since, ["account", "contact"])
				expect(removed()).toHaveLength(1)
				// A sweep of accounts only leaves contacts alone.
				yield* sweep(world, "clerk", new Date("2100-01-01T00:00:00.000Z"), ["account"])
				expect(liveContacts(world)).toEqual(["ann"])
				// A removed record seen again (a later listing) is back.
				yield* world.ingest("clerk", [clerkOrg("org_1", "Acme"), member("bob", "org_1")])
				expect(liveContacts(world)).toEqual(["ann", "bob"])
				expect(accounts(world).map((account) => account.name)).toContain("Acme")
			}),
		))

	it("does not let a late delivery revive a deleted record", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [clerkOrg("org_1", "Acme"), member("ann", "org_1")])
				yield* world.ingest("clerk", [
					member("ann", "org_1", { removed: true, observedAt: isoAt(0) }),
					{ ...clerkOrg("org_1", "Acme"), deleted: true, observedAt: isoAt(0) },
				])
				expect(accounts(world)).toHaveLength(0)

				// Observed before the deletion: nothing changes.
				const late = yield* world.ingest("clerk", [
					{ ...clerkOrg("org_1", "Acme Late"), observedAt: isoAt(-60_000) },
				])
				expect(outcomeTags(late)).toEqual(["Unchanged"])
				expect(accounts(world)).toHaveLength(0)
				expect(
					world.rows(
						`SELECT staleAt IS NOT NULL AS stale FROM customer_external_refs WHERE entityType = 'account'`,
					),
				).toEqual([{ stale: 1 }])

				// Observed after it (restored at the source): the account is back.
				const restored = yield* world.ingest("clerk", [
					{ ...clerkOrg("org_1", "Acme"), observedAt: isoAt(60_000) },
				])
				expect(outcomeTags(restored)).toEqual(["Updated"])
				expect(accounts(world).map((account) => account.name)).toEqual(["Acme"])

				const lateMember = yield* world.ingest("clerk", [
					member("ann", "org_1", { name: "Ann Late", observedAt: isoAt(-60_000) }),
				])
				expect(outcomeTags(lateMember)).toEqual(["Unchanged"])
				expect(liveContacts(world)).toEqual([])
				// Without `observedAt` an op applies whatever the order.
				yield* world.ingest("clerk", [member("ann", "org_1")])
				expect(liveContacts(world)).toEqual(["ann"])
			}),
		))

	it("matches by domain only when the op opts in, and merges a parked account's ops", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [clerkOrg("org_1", "Acme", ["acme.com"])])
				const report = yield* world.ingest("stripe", [
					// An identity-style op parking on no match: never merged by its domain.
					{
						_tag: "account",
						externalId: "cus_1",
						name: "Acme Inc",
						domains: ["acme.com"],
						sameAs: [],
						onNoMatch: "unmatched",
					},
				])
				expect(outcomeTags(report)).toEqual(["Unmatched"])

				yield* world.ingest("stripe", [
					stripeCustomer("cus_2", {
						name: "Initech",
						domains: ["initech.com"],
						attributes: { a: 1 },
					}),
				])
				yield* world.ingest("stripe", [
					stripeCustomer("cus_2", { seatsUsed: 4, attributes: { b: 2 }, domains: ["initech.io"] }),
				])
				const [record] = world.rows<{ label: string; domain: string; payload: string }>(
					`SELECT label, domain, payload FROM customer_unmatched_records WHERE externalId = 'cus_2'`,
				)
				expect(record).toMatchObject({ label: "Initech", domain: "initech.com" })
				expect(JSON.parse(record!.payload)).toEqual([
					expect.objectContaining({
						name: "Initech",
						seatsUsed: 4,
						domains: ["initech.com", "initech.io"],
						attributes: { a: 1, b: 2 },
					}),
				])
			}),
		))

	it("ignores the members, billing and usage of an ignored account", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				// A removed member of an unknown organization is not parked.
				const gone = yield* world.ingest("clerk", [member("ann", "org_9", { removed: true })])
				expect(outcomeTags(gone)).toEqual(["Unchanged"])
				expect(world.rows(`SELECT id FROM customer_unmatched_records`)).toEqual([])

				// Ignored by hand (no rule): its members and usage are ignored too.
				const orgTest = { provider: "clerk" as const, externalId: "org_test" }
				const usage: IngestOp = {
					_tag: "activity",
					contact: { provider: "clerk", externalId: "bob" },
					account: orgTest,
					day: today,
					eventCount: 3,
				}
				yield* world.ingest("maple", [usage])
				const byHandRecord = world.rows<{ id: string }>(
					`SELECT id FROM customer_unmatched_records`,
				)[0]!
				yield* world.call("customers.unmatched.ignore", { recordId: byHandRecord.id }, world.owner)
				const byHand = yield* world.ingest("clerk", [member("bob", "org_test")])
				expect(byHand.outcomes).toEqual([{ _tag: "Ignored", ruleId: null }])
				expect((yield* world.ingest("maple", [usage])).outcomes).toEqual([
					{ _tag: "Ignored", ruleId: null },
				])

				// Ignored by a rule on its id: billing and metrics naming a matching id too.
				yield* world.ingest("stripe", [stripeCustomer("cus_test", { name: "Test" })])
				const record = world.rows<{ id: string }>(
					`SELECT id FROM customer_unmatched_records WHERE externalId = 'cus_test'`,
				)[0]!
				yield* world.call(
					"customers.unmatched.ignore",
					{ recordId: record.id, rule: { field: "external_id", pattern: "cus_test*" } },
					world.owner,
				)
				const byRule = yield* world.ingest("stripe", [
					{
						_tag: "metric",
						account: { provider: "stripe", externalId: "cus_test2" },
						metricKey: "api_requests",
						day: today,
						value: 3,
					},
					{
						_tag: "invoice",
						externalId: "in_1",
						account: { provider: "stripe", externalId: "cus_test3" },
						subscriptionExternalId: null,
						number: null,
						status: "paid",
						amountDueMinor: 100,
						amountPaidMinor: 100,
						currency: "usd",
						issuedAt: null,
						dueAt: null,
						paidAt: null,
						attemptCount: 1,
					},
				])
				expect(outcomeTags(byRule)).toEqual(["Ignored", "Ignored"])
				expect(
					world.rows(
						`SELECT externalId, status FROM customer_unmatched_records ORDER BY externalId`,
					),
				).toEqual([
					{ externalId: "cus_test", status: "ignored" },
					{ externalId: "org_test", status: "ignored" },
				])
			}),
		))

	it("never moves sign-in times or a day's sessions backwards", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const seen = isoAt(-60_000)
				yield* world.ingest("clerk", [
					clerkOrg("org_1", "Acme"),
					member("ann", "org_1", { lastSeenAt: seen, lastSignInAt: seen }),
				])
				const older = yield* world.ingest("clerk", [
					member("ann", "org_1", { lastSeenAt: isoAt(-3_600_000), lastSignInAt: null }),
				])
				expect(outcomeTags(older)).toEqual(["Unchanged"])
				const contact = () =>
					world.rows<{ lastSeenAt: string | number; lastSignInAt: string | number }>(
						`SELECT lastSeenAt, lastSignInAt FROM customer_contacts`,
					)[0]!
				const before = contact()
				yield* world.ingest("clerk", [member("ann", "org_1", { lastSeenAt: isoAt(0) })])
				expect(contact().lastSeenAt).not.toEqual(before.lastSeenAt)
				expect(contact().lastSignInAt).toEqual(before.lastSignInAt)

				const activity = (fields: { sessionCount?: number; signedIn?: boolean }): IngestOp => ({
					_tag: "activity",
					contact: { provider: "clerk", externalId: "ann" },
					account: { provider: "clerk", externalId: "org_1" },
					day: today,
					...fields,
				})
				const day = () => world.rows(`SELECT sessionCount, signedIn FROM customer_activity_daily`)[0]
				yield* world.ingest("clerk", [activity({ sessionCount: 5, signedIn: true })])
				const retry = yield* world.ingest("clerk", [activity({ sessionCount: 3, signedIn: false })])
				expect(outcomeTags(retry)).toEqual(["Unchanged"])
				expect(day()).toEqual({ sessionCount: 5, signedIn: 1 })
				yield* world.ingest("clerk", [activity({ sessionCount: 7 })])
				expect(day()).toEqual({ sessionCount: 7, signedIn: 1 })
			}),
		))

	it("keeps only hostnames as domains, and only https links on the provider's hosts", () =>
		run(
			Effect.gen(function* () {
				expect(
					["https://www.Acme.com/pricing", "a@acme.com", "acme.com:8080", "acme"].map(
						normalizeDomain,
					),
				).toEqual(["acme.com", null, null, null])
				const world = yield* makeCustomersWorld
				const org = (externalId: string, externalUrl: string): IngestOp => ({
					_tag: "account",
					externalId,
					externalUrl,
					name: externalId,
					sameAs: [],
					onNoMatch: "create",
				})
				yield* world.ingest("clerk", [
					org("org_1", "https://dashboard.clerk.com/organizations/org_1"),
					org("org_2", "javascript:alert(1)"),
					org("org_3", "https://evil.example/clerk.com"),
					org("org_4", "http://dashboard.clerk.com/organizations/org_4"),
				])
				expect(
					world.rows(
						`SELECT externalId, externalUrl FROM customer_external_refs ORDER BY externalId`,
					),
				).toEqual([
					{ externalId: "org_1", externalUrl: "https://dashboard.clerk.com/organizations/org_1" },
					{ externalId: "org_2", externalUrl: null },
					{ externalId: "org_3", externalUrl: null },
					{ externalId: "org_4", externalUrl: null },
				])
			}),
		))
})
