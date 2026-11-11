/**
 * Clerk webhook deliveries: Svix verification with the connection's signing secret, then each
 * subscribed event type's ops, over the recorded payloads. Deliveries are signed here exactly as
 * Clerk signs them, so the verification path is the real one.
 */
import type { IngestOp, UpsertAccount, UpsertContact } from "@hazel/domain/customers"
import { Effect, Redacted } from "effect"
import { HttpClient } from "effect/http"
import { describe, expect, it } from "vitest"
import {
	DOMAIN_ACME,
	envelope,
	INSTANCE,
	MEMBERSHIP_ADA_ADMIN,
	MEMBERSHIP_ADA_GLOBEX,
	ORG_ACME,
	ORG_GLOBEX,
	SESSION_ADA,
	SESSION_ADA_NO_ORG,
	USER_ADA,
} from "./fixtures"
import { makeClerkGet, WEBHOOK_REQUESTS } from "./http"
import { type FakeClerkState, fakeClerkHttpClient, makeFakeClerk } from "./testing"
import { receiveWebhook } from "./webhook"
import { signSvix } from "../svix"

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
const API_KEY = "sk_test_fake000000000000000000"
/** Svix refuses a delivery signed more than five minutes ago, so deliveries are signed as of now. */
const nowMs = () => Date.now()
const MSG_ID = "msg_2hazel00000000000000000"

const fake = makeFakeClerk({
	secretKey: API_KEY,
	users: [USER_ADA],
	memberships: [MEMBERSHIP_ADA_ADMIN, MEMBERSHIP_ADA_GLOBEX],
	domains: [DOMAIN_ACME],
})

/** The adapter's webhook `get`, over the fake Clerk: no 429 is waited out in place. */
const getOf = Effect.map(HttpClient.HttpClient, (client) =>
	makeClerkGet(client, Redacted.make(API_KEY), WEBHOOK_REQUESTS),
)

const deliver = (
	body: string,
	options: {
		readonly secret?: string
		readonly tamper?: boolean
		readonly timestampMs?: number
		readonly createAccounts?: boolean
		readonly instanceId?: string | null
		readonly clerk?: FakeClerkState
	} = {},
) =>
	Effect.gen(function* () {
		const timestamp = String(Math.floor((options.timestampMs ?? nowMs()) / 1000))
		const signature = yield* signSvix(SECRET, MSG_ID, timestamp, body)
		return yield* receiveWebhook({
			get: yield* getOf,
			headers: {
				"svix-id": MSG_ID,
				"svix-timestamp": timestamp,
				"svix-signature": `v1,${signature}`,
			},
			body: options.tamper === true ? `${body} ` : body,
			webhookSecret: Redacted.make(options.secret ?? SECRET),
			instanceId: options.instanceId === undefined ? INSTANCE.id : options.instanceId,
			onNoMatch: options.createAccounts === false ? "unmatched" : "create",
		})
	}).pipe(Effect.provide(fakeClerkHttpClient(options.clerk ?? fake)))

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
const tags = (ops: ReadonlyArray<IngestOp>) => ops.map((op) => op._tag)

describe("Clerk webhook verification", () => {
	it("accepts a delivery Clerk signed", async () => {
		const ops = await run(deliver(envelope("organization.updated", ORG_ACME)))
		expect(tags(ops)).toEqual(["account"])
	})

	it("refuses a tampered body, a wrong secret and a replay", async () => {
		const body = envelope("organization.updated", ORG_ACME)
		expect((await run(Effect.flip(deliver(body, { tamper: true })))).message).toMatch(/signature/i)
		expect(
			(await run(Effect.flip(deliver(body, { secret: "whsec_AAAAAAAAAAAAAAAAAAAAAA==" })))).message,
		).toMatch(/signature/i)
		expect(
			(await run(Effect.flip(deliver(body, { timestampMs: nowMs() - 10 * 60_000 })))).message,
		).toMatch(/replay window/i)
	})

	it("refuses a body that is not JSON, and one that is not a Clerk envelope", async () => {
		expect((await run(Effect.flip(deliver("not json")))).message).toMatch(/envelope/i)
		expect((await run(Effect.flip(deliver(JSON.stringify({ hello: "world" }))))).message).toMatch(
			/envelope/i,
		)
	})

	it("refuses an event from another Clerk instance than the secret key opens", async () => {
		const body = envelope("organization.updated", ORG_ACME)
		const error = await run(Effect.flip(deliver(body, { instanceId: "ins_2development000000000" })))
		expect(error.message).toMatch(/not stamped with the Clerk instance/i)
		// A connection with no instance on record cannot vouch for any.
		const unknown = await run(Effect.flip(deliver(body, { instanceId: null })))
		expect(unknown.message).toMatch(/not stamped with the Clerk instance/i)
		// Nor can an event that names no instance.
		const unstamped = JSON.stringify({ ...JSON.parse(body), instance_id: null })
		expect((await run(Effect.flip(deliver(unstamped)))).message).toMatch(
			/not stamped with the Clerk instance/i,
		)
	})

	it("refuses a subscribed event whose payload is malformed, rather than retrying it forever", async () => {
		const error = await run(
			Effect.flip(deliver(envelope("organization.updated", { name: "No id here" }))),
		)
		expect(error.message).toMatch(/not the shape Clerk documents/i)
	})
})

describe("Clerk webhook events", () => {
	it("organization.created writes the account and one timeline entry keyed on the organization", async () => {
		const ops = await run(deliver(envelope("organization.created", ORG_ACME)))
		expect(tags(ops)).toEqual(["account", "event"])
		// Ordered by the organization's own `updated_at`; never matched by domain.
		expect(ops[0]).toMatchObject({ observedAt: "2026-11-02T17:40:00.000Z" })
		expect(ops[0]).not.toHaveProperty("matchByDomain")
		expect(ops[1]).toMatchObject({
			externalId: `clerk:organization.created:${ORG_ACME.id}`,
			type: "account.created",
			occurredAt: "2026-01-14T09:12:00.000Z",
		})
	})

	it("organization.deleted stales the ref, dated by the event; a payload with no id is a no-op", async () => {
		const ops = await run(
			deliver(
				envelope("organization.deleted", { object: "organization", id: ORG_ACME.id, deleted: true }),
			),
		)
		expect(ops).toEqual([
			{
				_tag: "account",
				externalId: ORG_ACME.id,
				sameAs: [],
				onNoMatch: "unmatched",
				deleted: true,
				observedAt: "2026-11-10T08:21:01.000Z",
			},
		] satisfies Array<UpsertAccount>)
		expect(
			await run(deliver(envelope("organization.deleted", { object: "organization", deleted: true }))),
		).toEqual([])
	})

	it("organizationMembership.created writes the account then the contact with its role", async () => {
		const ops = await run(deliver(envelope("organizationMembership.created", MEMBERSHIP_ADA_ADMIN)))
		expect(tags(ops)).toEqual(["account", "contact"])
		// The membership's copy of the organization may be older than what Hazel holds: ref only.
		expect(ops[0]).toEqual({
			_tag: "account",
			externalId: ORG_ACME.id,
			externalUrl: `https://dashboard.clerk.com/last-active?path=organizations/${ORG_ACME.id}`,
			sameAs: [],
			// Never creates it: an unknown organization waits for its own event or the sweep.
			onNoMatch: "unmatched",
			observedAt: expect.any(String),
		})
		expect(ops[1]).toMatchObject({
			externalId: USER_ADA.id,
			account: { provider: "clerk", externalId: ORG_ACME.id },
			role: "Admin",
			joinedAt: "2026-01-14T09:12:00.000Z",
		})
	})

	it("organizationMembership.deleted removes the contact and never writes the organization", async () => {
		const ops = await run(deliver(envelope("organizationMembership.deleted", MEMBERSHIP_ADA_ADMIN)))
		// An account op here would revive an organization deleted with its memberships.
		expect(tags(ops)).toEqual(["contact"])
		// Dated by the event, when the membership went, not by its last update.
		expect(ops[0]).toMatchObject({ removed: true, observedAt: "2026-11-10T08:21:01.000Z" })
	})

	it("user.updated asks Clerk for the user's memberships and writes one contact and day per account", async () => {
		const before = fake.calls.length
		const ops = await run(deliver(envelope("user.updated", USER_ADA)))
		expect(fake.calls.slice(before).map((call) => call.path)).toEqual([
			`/users/${USER_ADA.id}/organization_memberships`,
		])
		const contacts = ops.filter((op): op is UpsertContact => op._tag === "contact")
		expect(contacts.map((contact) => contact.account.externalId)).toEqual([ORG_ACME.id, ORG_GLOBEX.id])
		expect(contacts.map((contact) => [contact.email, contact.observedAt])).toEqual([
			["ada@acme.com", "2026-11-10T08:21:00.000Z"],
			["ada@acme.com", "2026-11-10T08:21:00.000Z"],
		])
		// The `last_active_at` day in every account: Clerk does not say which one it was.
		expect(tags(ops)).toEqual(["contact", "activity", "contact", "activity"])
		expect(ops[1]).toEqual({
			_tag: "activity",
			contact: { provider: "clerk", externalId: USER_ADA.id },
			account: { provider: "clerk", externalId: ORG_ACME.id },
			day: "2026-11-10",
			sessionCount: 1,
		})
	})

	it("acknowledges user.updated when Clerk is throttling, without waiting it out", async () => {
		const clerk = makeFakeClerk({
			secretKey: API_KEY,
			users: [USER_ADA],
			memberships: [MEMBERSHIP_ADA_ADMIN],
			throttleAfter: 0,
			retryAfterSeconds: 1,
		})
		expect(await run(deliver(envelope("user.updated", USER_ADA), { clerk }))).toEqual([])
		expect(clerk.calls).toHaveLength(1)
	})

	it("user.created for a user with no organization yet writes nothing", async () => {
		const clerk = makeFakeClerk({ secretKey: API_KEY, users: [USER_ADA] })
		expect(await run(deliver(envelope("user.created", USER_ADA), { clerk }))).toEqual([])
	})

	it("user.deleted is verified and acknowledged; the membership events remove the contacts", async () => {
		expect(
			await run(deliver(envelope("user.deleted", { object: "user", id: USER_ADA.id, deleted: true }))),
		).toEqual([])
	})

	it("session.created credits the day to the session's organization, without asking Clerk", async () => {
		const before = fake.calls.length
		const ops = await run(deliver(envelope("session.created", SESSION_ADA)))
		expect(fake.calls.length).toBe(before)
		// The contact is matched by its Clerk user id; nothing it does not know is written.
		expect(ops).toEqual([
			{
				_tag: "contact",
				externalId: USER_ADA.id,
				account: { provider: "clerk", externalId: ORG_ACME.id },
				externalUrl: `https://dashboard.clerk.com/last-active?path=users/${USER_ADA.id}`,
				observedAt: "2026-11-10T08:21:00.000Z",
				lastSignInAt: "2026-11-10T08:21:00.000Z",
				lastSeenAt: "2026-11-10T08:21:00.000Z",
			},
			{
				_tag: "activity",
				contact: { provider: "clerk", externalId: USER_ADA.id },
				account: { provider: "clerk", externalId: ORG_ACME.id },
				day: "2026-11-10",
				sessionCount: 1,
				signedIn: true,
			},
		])
	})

	it("session.created with no active organization moves every account's sign-in, crediting none of two", async () => {
		const before = fake.calls.length
		const ops = await run(deliver(envelope("session.created", SESSION_ADA_NO_ORG)))
		expect(fake.calls.slice(before).map((call) => call.path)).toEqual([
			`/users/${USER_ADA.id}/organization_memberships`,
		])
		expect(tags(ops)).toEqual(["contact", "contact"])
		expect(ops[0]).toMatchObject({ email: "ada@acme.com", lastSignInAt: "2026-11-10T08:21:00.000Z" })
	})

	it("session.created with no active organization credits the day when the user has one", async () => {
		const clerk = makeFakeClerk({
			secretKey: API_KEY,
			users: [USER_ADA],
			memberships: [MEMBERSHIP_ADA_ADMIN],
		})
		const ops = await run(deliver(envelope("session.created", SESSION_ADA_NO_ORG), { clerk }))
		expect(tags(ops)).toEqual(["contact", "activity"])
		expect(ops[1]).toMatchObject({ account: { provider: "clerk", externalId: ORG_ACME.id } })
	})

	it("session.created still succeeds when that request fails, rather than being retried for days", async () => {
		const broken = makeFakeClerk({ secretKey: "sk_test_a_different_key", users: [USER_ADA] })
		expect(
			await run(deliver(envelope("session.created", SESSION_ADA_NO_ORG), { clerk: broken })),
		).toEqual([])
	})

	it("session.created for an impersonation writes nothing: the user did not sign in", async () => {
		const before = fake.calls.length
		const impersonated = { ...SESSION_ADA, actor: { sub: "user_2support0000000000000" } }
		expect(await run(deliver(envelope("session.created", impersonated)))).toEqual([])
		const unscoped = { ...SESSION_ADA_NO_ORG, actor: { sub: "user_2support0000000000000" } }
		expect(await run(deliver(envelope("session.created", unscoped)))).toEqual([])
		expect(fake.calls.length).toBe(before)
	})

	it("an event type nobody subscribed is acknowledged as a no-op", async () => {
		expect(await run(deliver(envelope("email.created", { id: "ema_1" })))).toEqual([])
	})

	it("honours `createAccounts: false` by parking organizations instead of creating them", async () => {
		const ops = await run(deliver(envelope("organization.created", ORG_ACME), { createAccounts: false }))
		expect((ops[0] as UpsertAccount).onNoMatch).toBe("unmatched")
	})

	it("is idempotent: the same delivery twice produces the same ops", async () => {
		const body = envelope("organizationMembership.created", MEMBERSHIP_ADA_ADMIN)
		expect(await run(deliver(body))).toEqual(await run(deliver(body)))
	})
})
