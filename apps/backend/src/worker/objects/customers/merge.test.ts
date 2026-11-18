/**
 * `customers.account.merge` on node SQLite: two Clerk organizations (each with its Stripe customer)
 * become one customer; the providers keep their ids and later syncs land on the kept account.
 */
import type { UpsertAccount, UpsertContact, UpsertSubscription } from "@hazel/domain/customers"
import type { CustomerAccountId } from "@hazel/schema"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { CustomerIngest } from "./ingest"
import { addDays } from "./time"
import { makeCustomersWorld, NOW, TODAY, uuid } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const clerkOrg = (id: string, name: string): UpsertAccount => ({
	_tag: "account",
	externalId: id,
	name,
	domains: [`${id}.com`],
	sameAs: [],
	onNoMatch: "create",
})

const stripeCustomer = (id: string, org: string): UpsertAccount => ({
	_tag: "account",
	externalId: id,
	name: `${org} billing`,
	sameAs: [{ provider: "clerk", externalId: org }],
	onNoMatch: "unmatched",
})

const member = (id: string, org: string, email: string): UpsertContact => ({
	_tag: "contact",
	externalId: id,
	account: { provider: "clerk", externalId: org },
	email,
	name: id,
})

const subscription = (id: string, customer: string, mrrMinor: number): UpsertSubscription => ({
	_tag: "subscription",
	externalId: id,
	account: { provider: "stripe", externalId: customer },
	planName: "Team",
	status: "active",
	mrrMinor,
	currency: "usd",
	interval: "month",
	quantity: 1,
	startedAt: new Date(NOW.getTime() - 40 * 86_400_000).toISOString(),
	trialEndsAt: null,
	currentPeriodEnd: null,
	cancelAtPeriodEnd: false,
	canceledAt: null,
})

describe("customers.account.merge", () => {
	it("moves the organizations, billing and users into one customer", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [
					clerkOrg("org_1", "Acme"),
					clerkOrg("org_2", "Acme EU"),
					member("user_a", "org_1", "ada@acme.com"),
					member("user_a", "org_2", "ada@acme.com"),
					member("user_b", "org_2", "bo@acme.com"),
					member("user_c", "org_1", "Cy@acme.com"),
					member("user_c2", "org_2", "cy@acme.com"),
				])
				yield* world.ingest("stripe", [
					stripeCustomer("cus_1", "org_1"),
					stripeCustomer("cus_2", "org_2"),
					subscription("sub_1", "cus_1", 10_000),
					subscription("sub_2", "cus_2", 5_000),
				])
				yield* world.ingest("maple", [
					{
						_tag: "activity",
						account: { provider: "clerk", externalId: "org_1" },
						contact: { provider: "clerk", externalId: "user_a" },
						day: TODAY,
						eventCount: 3,
					},
					{
						_tag: "activity",
						account: { provider: "clerk", externalId: "org_2" },
						contact: { provider: "clerk", externalId: "user_a" },
						day: TODAY,
						eventCount: 7,
					},
				])
				const idOf = (name: string) =>
					world.rows<{ id: CustomerAccountId }>(
						`SELECT id FROM customer_accounts WHERE name = ?`,
						name,
					)[0]!.id
				const kept = idOf("Acme")
				const merged = idOf("Acme EU")

				expect(
					(yield* world.call(
						"customers.account.merge",
						{ accountId: merged, intoAccountId: kept },
						world.member,
					))._tag,
				).toBe("Failure")
				expect(
					(yield* world.call(
						"customers.account.merge",
						{ accountId: kept, intoAccountId: kept },
						world.owner,
					))._tag,
				).toBe("Failure")
				const result = yield* world.call(
					"customers.account.merge",
					{ accountId: merged, intoAccountId: kept },
					world.owner,
				)
				expect(result._tag).toBe("Success")

				expect(
					world.rows(`SELECT id, organizationCount FROM customer_accounts WHERE deletedAt IS NULL`),
				).toEqual([{ id: kept, organizationCount: 2 }])
				expect(
					world.rows(
						`SELECT provider, externalId, name FROM customer_external_refs
						WHERE entityType = 'account' AND accountId = ? ORDER BY provider, externalId`,
						kept,
					),
				).toEqual([
					{ provider: "clerk", externalId: "org_1", name: "Acme" },
					{ provider: "clerk", externalId: "org_2", name: "Acme EU" },
					{ provider: "stripe", externalId: "cus_1", name: "org_1 billing" },
					{ provider: "stripe", externalId: "cus_2", name: "org_2 billing" },
				])
				expect(
					world.rows(
						`SELECT externalId, accountId FROM customer_subscriptions ORDER BY externalId`,
					),
				).toEqual([
					{ externalId: "sub_1", accountId: kept },
					{ externalId: "sub_2", accountId: kept },
				])
				// One person per membership pair (same Clerk user, or same email); bo moved as is.
				expect(
					world.rows(
						`SELECT lower(email) AS email FROM customer_contacts
						WHERE accountId = ? AND deletedAt IS NULL ORDER BY email`,
						kept,
					),
				).toEqual([{ email: "ada@acme.com" }, { email: "bo@acme.com" }, { email: "cy@acme.com" }])
				expect(
					world.rows(
						`SELECT day, eventCount FROM customer_activity_daily WHERE accountId = ?`,
						kept,
					),
				).toEqual([{ day: TODAY, eventCount: 7 }])
				expect(world.rows(`SELECT count(*) AS n FROM customer_activity_daily`)).toEqual([{ n: 1 }])
				expect(
					world.rows(
						`SELECT type FROM customer_events WHERE type = 'account.merged' AND accountId = ?`,
						kept,
					),
				).toEqual([{ type: "account.merged" }])

				// Later syncs of either organization land on the kept customer and keep its name.
				yield* world.ingest("clerk", [
					clerkOrg("org_2", "Acme Europe"),
					member("user_a", "org_2", "ada@acme.com"),
					member("user_d", "org_2", "di@acme.com"),
				])
				expect(world.rows(`SELECT id, name FROM customer_accounts WHERE deletedAt IS NULL`)).toEqual([
					{ id: kept, name: "Acme" },
				])
				expect(
					world.rows(
						`SELECT count(*) AS n FROM customer_contacts WHERE accountId = ? AND deletedAt IS NULL`,
						kept,
					),
				).toEqual([{ n: 4 }])
				expect(
					world.rows(
						`SELECT name FROM customer_external_refs WHERE provider = 'clerk' AND externalId = 'org_2'`,
					),
				).toEqual([{ name: "Acme Europe" }])

				// Ada is a member through both organizations: leaving one keeps her, leaving both removes her.
				const ada = () =>
					world.rows<{ deleted: number }>(
						`SELECT c.deletedAt IS NOT NULL AS deleted FROM customer_contacts AS c
						JOIN customer_external_refs AS r ON r.entityId = c.id
						WHERE r.entityType = 'contact' AND r.externalId = 'user_a' AND r.accountId = ?`,
						kept,
					)
				yield* world.ingest("clerk", [
					{ ...member("user_a", "org_2", "ada@acme.com"), removed: true },
				])
				expect(ada()).toEqual([{ deleted: 0 }])
				yield* world.ingest("clerk", [
					{ ...member("user_a", "org_1", "ada@acme.com"), removed: true },
				])
				expect(ada()).toEqual([{ deleted: 1 }])
				// She rejoins through one organization and leaves it: removed again.
				yield* world.ingest("clerk", [member("user_a", "org_2", "ada@acme.com")])
				expect(ada()).toEqual([{ deleted: 0 }])
				yield* world.ingest("clerk", [
					{ ...member("user_a", "org_2", "ada@acme.com"), removed: true },
				])
				expect(ada()).toEqual([{ deleted: 1 }])
			}),
		))

	it("folds two people into one, resolves a doubled signal and rebuilds the year's movements", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [
					clerkOrg("org_1", "Acme"),
					clerkOrg("org_2", "Acme EU"),
					member("user_a", "org_1", "ada@acme.com"),
					// The same Clerk user (folds by ref, brings the billing flag), then another one with
					// the kept contact's email (folds by email): the second fold keeps the first's.
					{ ...member("user_a", "org_2", "ada@old.com"), isBillingContact: true },
					member("user_z", "org_2", "ada@acme.com"),
				])
				const idOf = (name: string) =>
					world.rows<{ id: CustomerAccountId }>(
						`SELECT id FROM customer_accounts WHERE name = ?`,
						name,
					)[0]!.id
				const kept = idOf("Acme")
				const merged = idOf("Acme EU")
				const signal = (accountId: string, ruleId: string) =>
					world.rows(
						`INSERT INTO customer_signals (id, organizationId, accountId, ruleId, template, kind,
						severity, title, reason, evidence, openingEvidence) VALUES (?, ?, ?, ?, 'inactive', 'risk',
						'high', 'Quiet', 'Quiet', '{}', '{}')`,
						uuid(),
						world.orgId,
						accountId,
						ruleId,
					)
				const shared = uuid()
				const dismissed = uuid()
				const other = uuid()
				signal(kept, shared)
				signal(kept, dismissed)
				signal(merged, shared)
				signal(merged, dismissed)
				signal(merged, other)
				// Dismissed, waiting to reopen: still unclosed.
				world.rows(
					`UPDATE customer_signals SET status = 'dismissed' WHERE accountId = ? AND ruleId = ?`,
					merged,
					dismissed,
				)
				const movement = (accountId: string, day: string) =>
					world.rows(
						`INSERT INTO customer_mrr_movements (id, accountId, day, type, deltaMinor, fromMrrMinor,
						toMrrMinor, currency) VALUES (?, ?, ?, 'new', 100, 0, 100, 'usd')`,
						uuid(),
						accountId,
						day,
					)
				const old = addDays(TODAY, -400)
				movement(merged, old)
				movement(merged, addDays(TODAY, -10))
				movement(kept, addDays(TODAY, -20))

				const result = yield* world.call(
					"customers.account.merge",
					{ accountId: merged, intoAccountId: kept },
					world.owner,
				)
				expect(result._tag).toBe("Success")

				expect(
					world.rows(
						`SELECT lower(email) AS email, isBillingContact FROM customer_contacts
						WHERE accountId = ? AND deletedAt IS NULL`,
						kept,
					),
				).toEqual([{ email: "ada@acme.com", isBillingContact: 1 }])
				const statusOf = (ruleId: string) =>
					world.rows(
						`SELECT status, closedAt IS NOT NULL AS closed FROM customer_signals
						WHERE accountId = ? AND ruleId = ? ORDER BY status`,
						kept,
						ruleId,
					)
				expect(statusOf(shared)).toEqual([
					{ status: "auto_resolved", closed: 1 },
					{ status: "open", closed: 0 },
				])
				expect(statusOf(dismissed)).toEqual([
					{ status: "dismissed", closed: 1 },
					{ status: "open", closed: 0 },
				])
				expect(statusOf(other)).toEqual([{ status: "open", closed: 0 }])
				// The year's movements go (a rebuild brings them back); an older one moves.
				expect(world.rows(`SELECT accountId, day FROM customer_mrr_movements`)).toEqual([
					{ accountId: kept, day: old },
				])
				expect(world.rows(`SELECT value FROM _object_meta WHERE key LIKE '%rebuild%'`).length).toBe(1)
			}),
		))

	it("folds into a kept person revived by an earlier fold, by email", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [
					clerkOrg("org_1", "Acme"),
					clerkOrg("org_2", "Acme EU"),
					member("user_a", "org_1", "ada@acme.com"),
					member("user_a", "org_2", "ada@old.com"),
					member("user_z", "org_2", "ada@acme.com"),
				])
				// Ada left the kept organization: her contact there is deleted.
				yield* world.ingest("clerk", [
					{ ...member("user_a", "org_1", "ada@acme.com"), removed: true },
				])
				const idOf = (name: string) =>
					world.rows<{ id: CustomerAccountId }>(
						`SELECT id FROM customer_accounts WHERE name = ?`,
						name,
					)[0]!.id
				const kept = idOf("Acme")
				const result = yield* world.call(
					"customers.account.merge",
					{ accountId: idOf("Acme EU"), intoAccountId: kept },
					world.owner,
				)
				expect(result._tag).toBe("Success")
				expect(
					world.rows(
						`SELECT lower(email) AS email FROM customer_contacts WHERE accountId = ? AND deletedAt IS NULL`,
						kept,
					),
				).toEqual([{ email: "ada@acme.com" }])
			}),
		))

	it("drops a membership a full listing no longer sees", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [
					clerkOrg("org_1", "Acme"),
					clerkOrg("org_2", "Acme EU"),
					member("user_a", "org_1", "ada@acme.com"),
					member("user_a", "org_2", "ada@acme.com"),
				])
				const idOf = (name: string) =>
					world.rows<{ id: CustomerAccountId }>(
						`SELECT id FROM customer_accounts WHERE name = ?`,
						name,
					)[0]!.id
				const kept = idOf("Acme")
				yield* world.call(
					"customers.account.merge",
					{ accountId: idOf("Acme EU"), intoAccountId: kept },
					world.owner,
				)
				// She left Acme EU without a webhook: the next full listing sees her through Acme only.
				yield* Effect.sleep("5 millis")
				const since = new Date()
				yield* world.ingest("clerk", [
					clerkOrg("org_1", "Acme"),
					clerkOrg("org_2", "Acme EU"),
					member("user_a", "org_1", "ada@acme.com"),
				])
				yield* world.object.run(
					Effect.flatMap(CustomerIngest, (ingest) =>
						ingest.completeSweep(world.connection("clerk"), since, ["account", "contact"]),
					).pipe(Effect.provide(CustomerIngest.layer)),
				)
				const ada = () =>
					world.rows(
						`SELECT c.deletedAt IS NOT NULL AS deleted FROM customer_contacts AS c
						JOIN customer_external_refs AS r ON r.entityId = c.id
						WHERE r.entityType = 'contact' AND r.externalId = 'user_a' AND r.accountId = ?`,
						kept,
					)
				expect(ada()).toEqual([{ deleted: 0 }])
				// Leaving Acme now removes her.
				yield* world.ingest("clerk", [
					{ ...member("user_a", "org_1", "ada@acme.com"), removed: true },
				])
				expect(ada()).toEqual([{ deleted: 1 }])
			}),
		))
})
