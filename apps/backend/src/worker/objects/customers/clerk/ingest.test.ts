/**
 * The Clerk mapping against the real `CustomerIngest`, in a `CustomersObject` on node SQLite: the
 * ops this adapter produces have to resolve the identities they name, merge domains, land a
 * session's activity day and stay idempotent across a redelivery.
 */
import { Effect, Redacted, Schema, type Scope } from "effect"
import { HttpClient } from "effect/http"
import { describe, expect, it } from "vitest"
import { runCompute } from "../compute"
import type { PullPage } from "../providers"
import { type CustomersWorld, makeCustomersWorld } from "../test-kit"
import {
	DOMAIN_ACME,
	DOMAIN_ACME_EU,
	MEMBERSHIP_ADA_ADMIN,
	MEMBERSHIP_ADA_GLOBEX,
	MEMBERSHIP_GRACE_MEMBER,
	membership,
	ORG_ACME,
	ORG_GLOBEX,
	SESSION_ADA,
	USER_ADA,
	USER_GRACE,
} from "./fixtures"
import { makeClerkGet } from "./http"
import { accountDeletedOp, accountOp, domainsAccountOp, membershipOps, sessionOps } from "./map"
import { pullPage } from "./pull"
import { fakeClerkHttpClient, makeFakeClerk } from "./testing"
import { ClerkMembership, ClerkOrganization, ClerkSession, ClerkUser } from "./wire"

const org = Schema.decodeUnknownSync(ClerkOrganization)
const user = Schema.decodeUnknownSync(ClerkUser)
const member = Schema.decodeUnknownSync(ClerkMembership)
const session = Schema.decodeUnknownSync(ClerkSession)

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
	it("creates the accounts and their members, crediting each the user's last active day", () =>
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

				// Clerk does not say which of Ada's two organizations she was last active in: both are
				// credited the day. She signed in the day before, so neither day is a sign-in.
				expect(activity(world)).toEqual([
					{ day: "2026-11-10", signedIn: 0, sessionCount: 1, account: "Acme Analytics" },
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
					sessionOps({
						session: session(SESSION_ADA),
						accounts: [{ organizationId: ORG_ACME.id }],
						credit: true,
					}),
				)
				// The sweep's day in each account; the session's sign-in in the one it names.
				expect(activity(world)).toEqual([
					{ day: "2026-11-10", signedIn: 1, sessionCount: 1, account: "Acme Analytics" },
					{ day: "2026-11-10", signedIn: 0, sessionCount: 1, account: "Globex" },
				])
				// Matched by the Clerk user id: the contact keeps what the session does not say.
				expect(
					contacts(world).find((row) => row.account === "Acme Analytics" && row.role === "Admin"),
				).toEqual({
					email: "ada@acme.com",
					name: "Ada Lovelace",
					role: "Admin",
					account: "Acme Analytics",
					lastSignInAt: "2026-11-10 08:21:00.000",
					deletedAt: null,
				})
			}),
		))

	it("leaves a contact's email and name alone when a membership webhook's public data omits them", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", backfill)
				yield* world.ingest(
					"clerk",
					membershipOps({
						membership: member({
							...MEMBERSHIP_ADA_ADMIN,
							public_user_data: { user_id: USER_ADA.id },
						}),
						onNoMatch: "create",
					}),
				)
				expect(
					contacts(world).filter((row) => row.account === "Acme Analytics" && row.role === "Admin"),
				).toEqual([expect.objectContaining({ email: "ada@acme.com", name: "Ada Lovelace" })])
			}),
		))

	it("creates the contact from a session that arrives before their membership webhook", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				// Only the organization is known: Ada has no contact row yet.
				yield* world.ingest("clerk", [accountOp(org(ORG_ACME), "create")])
				yield* world.ingest(
					"clerk",
					sessionOps({
						session: session(SESSION_ADA),
						accounts: [{ organizationId: ORG_ACME.id }],
						credit: true,
					}),
				)
				expect(activity(world)).toEqual([
					{ day: "2026-11-10", signedIn: 1, sessionCount: 1, account: "Acme Analytics" },
				])
				// The activity belongs to a real contact, not to the unmatched queue.
				expect(world.rows(`SELECT count(*) AS n FROM customer_unmatched_records`)).toEqual([{ n: 0 }])
				// ...and the membership webhook then lands on that same contact (by its Clerk user id) and
				// fills in what the session could not say.
				yield* world.ingest(
					"clerk",
					membershipOps({ membership: member(MEMBERSHIP_ADA_ADMIN), onNoMatch: "create" }),
				)
				expect(
					contacts(world).map((row) => ({
						email: row.email,
						account: row.account,
						role: row.role,
					})),
				).toEqual([{ email: "ada@acme.com", account: "Acme Analytics", role: "Admin" }])
			}),
		))

	it("a late membership removal or organization update does not revive a deleted organization", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", backfill)
				// `organization.deleted`, dated by the event: after the organization's last update.
				const deletedAt = new Date(ORG_ACME.updated_at + 60_000).toISOString()
				yield* world.ingest("clerk", [accountDeletedOp(ORG_ACME.id, deletedAt)])
				expect(accounts(world).map((row) => row.name)).toEqual(["Globex"])
				// Clerk's retries, observed before the deletion.
				const observedAt = new Date(ORG_ACME.updated_at).toISOString()
				yield* world.ingest("clerk", [
					...membershipOps({
						membership: member(MEMBERSHIP_GRACE_MEMBER),
						onNoMatch: "create",
						removed: true,
						observedAt,
					}),
					accountOp(org(ORG_ACME), "create", observedAt),
				])
				expect(accounts(world).map((row) => row.name)).toEqual(["Globex"])
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
					// Ada, active in both accounts as far as the sweep can tell; Grace never was.
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

	it("a Clerk-only customer whose members were active yesterday reads as active, not stalled", () =>
		run(
			Effect.gen(function* () {
				const now = new Date()
				const daysAgo = (days: number) => now.getTime() - days * 86_400_000
				// Twenty days old: inside the default onboarding window, where two active members are enough.
				const organization = { ...ORG_ACME, created_at: daysAgo(20), updated_at: daysAgo(20) }
				const users = [USER_ADA, USER_GRACE].map((clerkUser) => ({
					...clerkUser,
					last_sign_in_at: daysAgo(3),
					last_active_at: daysAgo(1),
				}))
				const clerk = makeFakeClerk({
					secretKey: "sk_test_fake000000000000000000",
					organizations: [organization],
					memberships: users.map((clerkUser, index) =>
						membership({
							id: `orgmem_${index}`,
							organization,
							userId: clerkUser.id,
							identifier: `${clerkUser.id}@acme.com`,
							createdAt: daysAgo(20 - index),
						}),
					),
					users,
				})
				const world = yield* makeCustomersWorld
				// The real sweep, page by page, as the alarm runs it.
				const get = yield* Effect.map(HttpClient.HttpClient, (client) =>
					makeClerkGet(client, Redacted.make(clerk.secretKey)),
				).pipe(Effect.provide(fakeClerkHttpClient(clerk)))
				let cursor: string | null = null
				do {
					const page: PullPage = yield* pullPage({
						get,
						cursor,
						config: { _tag: "clerk", createAccounts: true },
					})
					yield* world.ingest("clerk", page.ops)
					cursor = page.nextCursor
				} while (cursor !== null)
				expect(world.rows(`SELECT count(*) AS n FROM customer_unmatched_records`)).toEqual([{ n: 0 }])

				yield* world.object.run(runCompute(now)).pipe(Effect.orDie)
				const [account] = world.rows<{ healthStatus: string; healthScore: number | null }>(
					`SELECT healthStatus, healthScore FROM customer_accounts`,
				)
				expect(account!.healthStatus).not.toBe("critical")
				expect(account!.healthScore).not.toBeNull()
				expect(
					world.rows(
						`SELECT template FROM customer_signals
						 WHERE template IN ('onboarding_stalled', 'inactive', 'champion_inactive') AND status = 'open'`,
					),
				).toEqual([])
			}),
		))
})
