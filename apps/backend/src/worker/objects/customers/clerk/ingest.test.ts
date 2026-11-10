/**
 * The Clerk mapping against the real `CustomerIngest`, in a `CustomersObject` on node SQLite: the
 * ops this adapter produces have to resolve the identities they name, merge domains, land the
 * activity days and stay idempotent across a redelivery.
 */
import { Effect, Schema, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { type CustomersWorld, makeCustomersWorld } from "../test-kit"
import {
	DOMAIN_ACME,
	DOMAIN_ACME_EU,
	MEMBERSHIP_ADA_ADMIN,
	MEMBERSHIP_ADA_GLOBEX,
	MEMBERSHIP_GRACE_MEMBER,
	ORG_ACME,
	ORG_GLOBEX,
	SESSION_ADA,
	USER_ADA,
	USER_GRACE,
} from "./fixtures"
import { accountOp, domainsAccountOp, membershipOps, sessionOps } from "./map"
import { ClerkMembership, ClerkOrganization, ClerkSession, ClerkUser } from "./wire"

const org = Schema.decodeUnknownSync(ClerkOrganization)
const user = Schema.decodeUnknownSync(ClerkUser)
const member = Schema.decodeUnknownSync(ClerkMembership)

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

/** A whole Clerk backfill of the fixture instance, in the order the sweep produces it. */
const backfill = [
	accountOp(org(ORG_ACME), "create"),
	accountOp(org(ORG_GLOBEX), "create"),
	...membershipOps({ membership: member(MEMBERSHIP_ADA_ADMIN), user: user(USER_ADA), onNoMatch: "create" }),
	...membershipOps({
		membership: member(MEMBERSHIP_GRACE_MEMBER),
		user: user(USER_GRACE),
		onNoMatch: "create",
	}),
	...membershipOps({
		membership: member(MEMBERSHIP_ADA_GLOBEX),
		user: user(USER_ADA),
		onNoMatch: "create",
	}),
	domainsAccountOp(ORG_ACME.id, [DOMAIN_ACME.name, DOMAIN_ACME_EU.name], "create"),
]

const accounts = (world: CustomersWorld) =>
	world.rows<{
		name: string
		domains: string
		logoUrl: string | null
		seatsUsed: number | null
		seatsLimit: number | null
		firstSeenAt: string
	}>(
		`SELECT name, domains, logoUrl, seatsUsed, seatsLimit, firstSeenAt FROM customer_accounts WHERE deletedAt IS NULL ORDER BY name`,
	)

const contacts = (world: CustomersWorld) =>
	world.rows<{
		email: string | null
		name: string | null
		role: string | null
		account: string
		lastSignInAt: string | null
		deletedAt: string | null
	}>(
		`SELECT c.email, c.name, c.role, a.name AS account, c.lastSignInAt, c.deletedAt
		 FROM customer_contacts c JOIN customer_accounts a ON a.id = c.accountId
		 ORDER BY a.name, c.email`,
	)

const activity = (world: CustomersWorld) =>
	world.rows<{ day: string; signedIn: number; sessionCount: number | null; account: string }>(
		`SELECT d.day, d.signedIn, d.sessionCount, a.name AS account
		 FROM customer_activity_daily d JOIN customer_accounts a ON a.id = d.accountId
		 ORDER BY a.name, d.day`,
	)

const refs = (world: CustomersWorld) =>
	world.rows<{ provider: string; externalId: string; entityType: string; matchMethod: string }>(
		`SELECT provider, externalId, entityType, matchMethod FROM customer_external_refs ORDER BY entityType, externalId`,
	)

describe("Clerk ops through CustomerIngest", () => {
	it("creates the accounts, their members and the days Clerk knows they were active", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const report = yield* world.ingest("clerk", backfill)
				expect(report.outcomes.filter((outcome) => outcome._tag === "Unmatched")).toEqual([])

				expect(accounts(world)).toEqual([
					{
						name: "Acme Analytics",
						domains: '["acme.com","acme.eu"]',
						logoUrl: "https://img.clerk.com/acme.png",
						seatsUsed: 12,
						seatsLimit: 25,
						firstSeenAt: "2026-01-14 09:12:00.000",
					},
					{
						name: "Globex",
						domains: "[]",
						logoUrl: null,
						seatsUsed: null,
						seatsLimit: null,
						firstSeenAt: "2026-09-30 11:00:00.000",
					},
				])

				// Ada is a contact of both accounts, with the role she holds in each.
				expect(contacts(world)).toEqual([
					{
						email: null,
						name: "Grace",
						role: "Member",
						account: "Acme Analytics",
						lastSignInAt: null,
						deletedAt: null,
					},
					{
						email: "ada@acme.com",
						name: "Ada Lovelace",
						role: "Admin",
						account: "Acme Analytics",
						lastSignInAt: "2026-11-09 08:21:00.000",
						deletedAt: null,
					},
					{
						email: "ada@acme.com",
						name: "Ada Lovelace",
						role: "billing_manager",
						account: "Globex",
						lastSignInAt: "2026-11-09 08:21:00.000",
						deletedAt: null,
					},
				])

				// Grace has never signed in: no activity row, so she cannot count as an active user.
				expect(activity(world)).toEqual([
					{ day: "2026-11-09", signedIn: 1, sessionCount: 1, account: "Acme Analytics" },
					{ day: "2026-11-10", signedIn: 0, sessionCount: 1, account: "Acme Analytics" },
					{ day: "2026-11-09", signedIn: 1, sessionCount: 1, account: "Globex" },
					{ day: "2026-11-10", signedIn: 0, sessionCount: 1, account: "Globex" },
				])

				// The Clerk org id is the account's ref — the shared id Stripe, Autumn and Maple match on.
				expect(refs(world)).toEqual([
					{
						provider: "clerk",
						externalId: ORG_ACME.id,
						entityType: "account",
						matchMethod: "created",
					},
					{
						provider: "clerk",
						externalId: ORG_GLOBEX.id,
						entityType: "account",
						matchMethod: "created",
					},
					{
						provider: "clerk",
						externalId: USER_ADA.id,
						entityType: "contact",
						matchMethod: "created",
					},
					{
						provider: "clerk",
						externalId: USER_ADA.id,
						entityType: "contact",
						matchMethod: "created",
					},
					{
						provider: "clerk",
						externalId: USER_GRACE.id,
						entityType: "contact",
						matchMethod: "created",
					},
				])
			}),
		))

	it("is idempotent: replaying the sweep writes nothing and leaves the change log alone", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", backfill)
				const before = world.rows<{ n: number }>(`SELECT count(*) AS n FROM _changes`)[0]!.n
				const again = yield* world.ingest("clerk", backfill)
				expect(again.outcomes.every((outcome) => outcome._tag === "Unchanged")).toBe(true)
				expect(world.rows<{ n: number }>(`SELECT count(*) AS n FROM _changes`)[0]!.n).toBe(before)
			}),
		))

	it("applies a session delivery as a sign-in day on the account the session names", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", backfill)
				yield* world.ingest(
					"clerk",
					sessionOps(Schema.decodeUnknownSync(ClerkSession)(SESSION_ADA), [ORG_ACME.id]),
				)
				expect(activity(world).filter((row) => row.account === "Acme Analytics")).toEqual([
					{ day: "2026-11-09", signedIn: 1, sessionCount: 1, account: "Acme Analytics" },
					// The same day Clerk had only reported activity on is now a sign-in.
					{ day: "2026-11-10", signedIn: 1, sessionCount: 1, account: "Acme Analytics" },
				])
			}),
		))

	it("removes a contact when their membership goes, and raises contact.removed", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", backfill)
				yield* world.ingest(
					"clerk",
					membershipOps({
						membership: member(MEMBERSHIP_GRACE_MEMBER),
						user: user(USER_GRACE),
						onNoMatch: "create",
						removed: true,
					}),
				)
				expect(contacts(world).find((row) => row.name === "Grace")?.deletedAt).not.toBeNull()
				expect(
					world.rows<{ type: string }>(
						`SELECT type FROM customer_events WHERE type LIKE 'contact.%' ORDER BY type`,
					),
				).toEqual([
					// Ada, in each of her two accounts; Grace was never active.
					{ type: "contact.first_active" },
					{ type: "contact.first_active" },
					{ type: "contact.joined" },
					{ type: "contact.joined" },
					{ type: "contact.joined" },
					{ type: "contact.removed" },
				])
			}),
		))

	it("parks an organization it may not create, and never merges two Clerk orgs by domain", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const report = yield* world.ingest("clerk", [
					accountOp(org(ORG_ACME), "unmatched"),
					accountOp(org(ORG_GLOBEX), "unmatched"),
				])
				expect(report.outcomes.map((outcome) => outcome._tag)).toEqual(["Unmatched", "Unmatched"])
				expect(accounts(world)).toEqual([])
				expect(
					world.rows<{ provider: string; entityType: string; label: string }>(
						`SELECT provider, entityType, label FROM customer_unmatched_records ORDER BY label`,
					),
				).toEqual([
					{ provider: "clerk", entityType: "account", label: "Acme Analytics" },
					{ provider: "clerk", entityType: "account", label: "Globex" },
				])
			}),
		))
})
