/**
 * Clerk records → `IngestOp`s, over the recorded payloads in `./fixtures.ts` (decoded through the
 * wire schemas first, so the schemas are held to the real shapes too).
 */
import { IngestOp, type UpsertAccount, type UpsertContact } from "@hazel/domain/customers"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
	DOMAIN_ACME,
	MEMBERSHIP_ADA_ADMIN,
	MEMBERSHIP_ADA_GLOBEX,
	MEMBERSHIP_GRACE_MEMBER,
	ORG_ACME,
	ORG_GLOBEX,
	SESSION_ADA,
	USER_ADA,
	USER_GRACE,
} from "./fixtures"
import {
	accountCreatedEvent,
	accountDeletedOp,
	accountOp,
	contactOp,
	domainsAccountOp,
	membershipOps,
	onNoMatchOf,
	sessionOps,
} from "./map"
import { ClerkMembership, ClerkOrganization, ClerkSession, ClerkUser } from "./wire"

const org = Schema.decodeUnknownSync(ClerkOrganization)
const user = Schema.decodeUnknownSync(ClerkUser)
const member = Schema.decodeUnknownSync(ClerkMembership)
const session = Schema.decodeUnknownSync(ClerkSession)

const acme = org(ORG_ACME)
const globex = org(ORG_GLOBEX)
const ada = user(USER_ADA)
const grace = user(USER_GRACE)

describe("accountOp", () => {
	it("maps an organization, and keeps the Clerk org id as the account's own ref", () => {
		expect(accountOp(acme, "create")).toEqual({
			_tag: "account",
			externalId: "org_2acme000000000000000000",
			externalUrl:
				"https://dashboard.clerk.com/last-active?path=organizations/org_2acme000000000000000000",
			name: "Acme Analytics",
			logoUrl: "https://img.clerk.com/acme.png",
			seatsUsed: 12,
			seatsLimit: 25,
			attributes: { slug: "acme-analytics" },
			createdAt: "2026-01-14T09:12:00.000Z",
			// Clerk *is* the shared id every other source matches on, so it claims no other.
			sameAs: [],
			onNoMatch: "create",
		} satisfies UpsertAccount)
	})

	it("reads Clerk's placeholders as absent: no image, no slug, 0 memberships = unlimited", () => {
		const mapped = accountOp(globex, "create")
		expect(mapped.logoUrl).toBeNull()
		expect(mapped.seatsLimit).toBeNull()
		expect(mapped.attributes).toBeUndefined()
		// A payload without counts leaves the seats a pull established alone.
		expect(mapped.seatsUsed).toBeUndefined()
	})

	it("parks unmatched organizations when the connection may not create accounts", () => {
		expect(onNoMatchOf({ _tag: "clerk", createAccounts: false })).toBe("unmatched")
		expect(onNoMatchOf({ _tag: "clerk", createAccounts: true })).toBe("create")
		expect(accountOp(acme, "unmatched").onNoMatch).toBe("unmatched")
	})

	it("merges verified domains without ever inventing an account from one", () => {
		expect(domainsAccountOp(acme.id, ["acme.com", DOMAIN_ACME.name], "create")).toEqual({
			_tag: "account",
			externalId: acme.id,
			domains: ["acme.com", "acme.com"],
			sameAs: [],
			onNoMatch: "unmatched",
		} satisfies UpsertAccount)
	})

	it("marks a deleted organization's ref stale rather than guessing at a new one", () => {
		const at = "2026-03-01T00:00:00.000Z"
		expect(accountDeletedOp(acme.id, at)).toEqual({
			_tag: "account",
			externalId: acme.id,
			sameAs: [],
			onNoMatch: "unmatched",
			deleted: true,
			observedAt: at,
		} satisfies UpsertAccount)
	})
})

describe("contactOp", () => {
	it("maps a membership and its user: primary email, name, avatar, role, join and activity", () => {
		expect(
			contactOp({ membership: member(MEMBERSHIP_ADA_ADMIN), organizationId: acme.id, user: ada }),
		).toEqual({
			_tag: "contact",
			externalId: "user_2ada000000000000000000",
			account: { provider: "clerk", externalId: acme.id },
			externalUrl: "https://dashboard.clerk.com/last-active?path=users/user_2ada000000000000000000",
			email: "ada@acme.com",
			name: "Ada Lovelace",
			avatarUrl: "https://img.clerk.com/ada.png",
			role: "Admin",
			// The membership's own creation, not the user's signup: when they joined *this* account.
			joinedAt: "2026-01-14T09:12:00.000Z",
			lastSignInAt: "2026-11-09T08:21:00.000Z",
			lastSeenAt: "2026-11-10T00:00:00.000Z",
		} satisfies UpsertContact)
	})

	it("falls back to the membership's public user data, and leaves sign-ins untouched, with no user", () => {
		const mapped = contactOp({ membership: member(MEMBERSHIP_GRACE_MEMBER), organizationId: acme.id })
		expect(mapped).toMatchObject({
			email: "grace@acme.com",
			name: "Grace",
			avatarUrl: null,
			role: "Member",
		})
		expect(mapped).not.toHaveProperty("lastSignInAt")
		expect(mapped).not.toHaveProperty("lastSeenAt")
	})

	it("leaves what the public user data does not say as it is, rather than clearing it", () => {
		const mapped = contactOp({
			membership: member({ ...MEMBERSHIP_GRACE_MEMBER, public_user_data: { user_id: grace.id } }),
			organizationId: acme.id,
		})
		expect(mapped).not.toHaveProperty("email")
		expect(mapped).not.toHaveProperty("name")
		expect(mapped).not.toHaveProperty("avatarUrl")
	})

	it("names the role from its key when Clerk sends no display name", () => {
		expect(
			contactOp({ membership: member(MEMBERSHIP_ADA_GLOBEX), organizationId: globex.id })?.role,
		).toBe("billing_manager")
	})

	it("keeps a username-shaped identifier out of the email field", () => {
		const mapped = contactOp({
			membership: member({
				...MEMBERSHIP_GRACE_MEMBER,
				public_user_data: { user_id: grace.id, identifier: "ghopper" },
			}),
			organizationId: acme.id,
		})
		// A username says nothing about the address: the stored one is left as it is.
		expect(mapped).not.toHaveProperty("email")
		// The user record has no verified address either: a contact with no email, not a wrong one.
		expect(
			contactOp({ membership: member(MEMBERSHIP_GRACE_MEMBER), organizationId: acme.id, user: grace })
				?.email,
		).toBeNull()
	})

	it("removes the contact when the membership is gone", () => {
		expect(
			contactOp({ membership: member(MEMBERSHIP_ADA_ADMIN), organizationId: acme.id, removed: true })
				?.removed,
		).toBe(true)
	})
})

describe("timestamps", () => {
	it("drops a timestamp outside 1970–9999 rather than emit an op ingest refuses", () => {
		const odd = user({
			...USER_ADA,
			last_sign_in_at: 9e15,
			last_active_at: -86_400_000,
			created_at: 253_402_300_800_000,
		})
		const ops = membershipOps({
			membership: member({ ...MEMBERSHIP_ADA_ADMIN, created_at: 9e15 }),
			user: odd,
			onNoMatch: "create",
		})
		expect(ops.every(Schema.is(IngestOp))).toBe(true)
		expect(ops[1]).toMatchObject({ lastSignInAt: null, lastSeenAt: null })
		expect(ops[1]).not.toHaveProperty("joinedAt")
	})
})

describe("membershipOps", () => {
	it("orders the account before the contact that names it, and writes no activity day", () => {
		// Clerk's last sign-in does not say which of the user's organizations it was in.
		expect(
			membershipOps({ membership: member(MEMBERSHIP_ADA_ADMIN), user: ada, onNoMatch: "create" }).map(
				(op) => op._tag,
			),
		).toEqual(["account", "contact"])
	})

	it("skips the account when the sweep already wrote it in this page", () => {
		expect(
			membershipOps({
				membership: member(MEMBERSHIP_ADA_ADMIN),
				user: ada,
				onNoMatch: "create",
				withAccount: false,
			}).map((op) => op._tag),
		).toEqual(["contact"])
	})

	it("writes only the contact for a removal: no account op to revive a deleted org", () => {
		expect(
			membershipOps({
				membership: member(MEMBERSHIP_ADA_ADMIN),
				user: ada,
				onNoMatch: "create",
				removed: true,
			}).map((op) => op._tag),
		).toEqual(["contact"])
	})

	it("stamps the account and contact with `observedAt`, never with `matchByDomain`", () => {
		const ops = membershipOps({
			membership: member(MEMBERSHIP_ADA_ADMIN),
			user: ada,
			onNoMatch: "create",
			observedAt: "2026-11-10T08:21:00.000Z",
		})
		expect(ops[0]).toMatchObject({ _tag: "account", observedAt: "2026-11-10T08:21:00.000Z" })
		expect(ops[1]).toMatchObject({ _tag: "contact", observedAt: "2026-11-10T08:21:00.000Z" })
		expect(ops[0]).not.toHaveProperty("matchByDomain")
	})

	it("makes one contact per account for a user in several organizations", () => {
		const ops = [
			...membershipOps({ membership: member(MEMBERSHIP_ADA_ADMIN), user: ada, onNoMatch: "create" }),
			...membershipOps({ membership: member(MEMBERSHIP_ADA_GLOBEX), user: ada, onNoMatch: "create" }),
		]
		const contacts = ops.filter((op): op is UpsertContact => op._tag === "contact")
		expect(
			contacts.map((contact) => [contact.externalId, contact.account.externalId, contact.role]),
		).toEqual([
			[ada.id, acme.id, "Admin"],
			[ada.id, globex.id, "billing_manager"],
		])
	})
})

describe("events", () => {
	it("keys the one timeline entry Clerk adds on the organization, so a redelivery dedupes", () => {
		expect(accountCreatedEvent(acme, "2026-01-14T09:12:00.000Z")).toEqual({
			_tag: "event",
			externalId: `clerk:organization.created:${acme.id}`,
			account: { provider: "clerk", externalId: acme.id },
			type: "account.created",
			title: "Acme Analytics was created in Clerk",
			data: { slug: "acme-analytics" },
			occurredAt: "2026-01-14T09:12:00.000Z",
		})
	})
})

describe("sessionOps", () => {
	const observedAt = "2026-11-10T08:21:00.000Z"

	it("writes the contact from the membership, email included, before the sign-in day", () => {
		expect(
			sessionOps({
				session: session(SESSION_ADA),
				accounts: [{ organizationId: acme.id, membership: member(MEMBERSHIP_ADA_ADMIN) }],
				credit: true,
				observedAt,
			}),
		).toEqual([
			{
				_tag: "contact",
				externalId: ada.id,
				account: { provider: "clerk", externalId: acme.id },
				externalUrl: `https://dashboard.clerk.com/last-active?path=users/${ada.id}`,
				email: "ada@acme.com",
				name: "Ada Lovelace",
				avatarUrl: null,
				role: "Admin",
				joinedAt: "2026-01-14T09:12:00.000Z",
				observedAt,
				lastSignInAt: "2026-11-10T08:21:00.000Z",
				lastSeenAt: "2026-11-10T08:21:00.000Z",
			},
			{
				_tag: "activity",
				contact: { provider: "clerk", externalId: ada.id },
				account: { provider: "clerk", externalId: acme.id },
				day: "2026-11-10",
				sessionCount: 1,
				signedIn: true,
			},
		])
	})

	it("names only the user and account for the session's own organization, Clerk not asked", () => {
		expect(
			sessionOps({
				session: session(SESSION_ADA),
				accounts: [{ organizationId: acme.id }],
				credit: true,
				observedAt,
			})[0],
		).toEqual({
			_tag: "contact",
			externalId: ada.id,
			account: { provider: "clerk", externalId: acme.id },
			externalUrl: `https://dashboard.clerk.com/last-active?path=users/${ada.id}`,
			observedAt,
			lastSignInAt: "2026-11-10T08:21:00.000Z",
			lastSeenAt: "2026-11-10T08:21:00.000Z",
		} satisfies UpsertContact)
	})

	it("moves the sign-in in every account but credits no day when told not to", () => {
		const ops = sessionOps({
			session: session(SESSION_ADA),
			accounts: [
				{ organizationId: acme.id, membership: member(MEMBERSHIP_ADA_ADMIN) },
				{ organizationId: globex.id, membership: member(MEMBERSHIP_ADA_GLOBEX) },
			],
			credit: false,
		})
		expect(ops.map((op) => op._tag)).toEqual(["contact", "contact"])
	})

	it("writes nothing for a user Clerk lists in no organization", () => {
		expect(sessionOps({ session: session(SESSION_ADA), accounts: [], credit: true })).toEqual([])
	})
})
