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
import { makeClerkGet } from "./http"
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

/** The adapter's own `get`, over the fake Clerk. */
const getOf = Effect.map(HttpClient.HttpClient, (client) => makeClerkGet(client, Redacted.make(API_KEY)))

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
		expect(error.message).toMatch(/another Clerk instance/i)
		// Unchecked only when Clerk never said which instance the key opens.
		expect(tags(await run(deliver(body, { instanceId: null })))).toEqual(["account"])
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

	it("organization.deleted stales the ref; a payload with no id is a no-op", async () => {
		const ops = await run(
			deliver(
				envelope("organization.deleted", { object: "organization", id: ORG_ACME.id, deleted: true }),
			),
		)
		expect(ops).toEqual([
			{ _tag: "account", externalId: ORG_ACME.id, sameAs: [], onNoMatch: "unmatched", deleted: true },
		] satisfies Array<UpsertAccount>)
		expect(
			await run(deliver(envelope("organization.deleted", { object: "organization", deleted: true }))),
		).toEqual([])
	})

	it("organizationMembership.created writes the account then the contact with its role", async () => {
		const ops = await run(deliver(envelope("organizationMembership.created", MEMBERSHIP_ADA_ADMIN)))
		expect(tags(ops)).toEqual(["account", "contact"])
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
		expect((ops[0] as UpsertContact).removed).toBe(true)
	})

	it("user.updated asks Clerk for the user's memberships and writes one contact per account", async () => {
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
		// Each contact with the days the user record proves; the organizations' own events write those.
		expect(tags(ops)).toEqual(["contact", "activity", "activity", "contact", "activity", "activity"])
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

	it("session.created credits the day to the session's organization, its contact built from the membership", async () => {
		const ops = await run(deliver(envelope("session.created", SESSION_ADA)))
		// The contact first, with the email its membership carries: a session that lands before the
		// membership webhook creates the same contact the membership will name, not an email-less twin.
		expect(ops).toEqual([
			expect.objectContaining({
				_tag: "contact",
				externalId: USER_ADA.id,
				account: { provider: "clerk", externalId: ORG_ACME.id },
				email: "ada@acme.com",
				name: "Ada Lovelace",
				role: "Admin",
				lastSignInAt: "2026-11-10T08:21:00.000Z",
				lastSeenAt: "2026-11-10T08:21:00.000Z",
			}),
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

	it("session.created with no active organization asks Clerk once, then credits every account", async () => {
		const before = fake.calls.length
		const ops = await run(deliver(envelope("session.created", SESSION_ADA_NO_ORG)))
		expect(fake.calls.slice(before).map((call) => call.path)).toEqual([
			`/users/${USER_ADA.id}/organization_memberships`,
		])
		expect(
			ops
				.filter((op) => op._tag === "activity")
				.map((op) => (op as { account: { externalId: string } }).account.externalId),
		).toEqual([ORG_ACME.id, ORG_GLOBEX.id])
	})

	it("session.created still succeeds when that request fails, rather than being retried for days", async () => {
		const broken = makeFakeClerk({ secretKey: "sk_test_a_different_key", users: [USER_ADA] })
		expect(
			await run(deliver(envelope("session.created", SESSION_ADA_NO_ORG), { clerk: broken })),
		).toEqual([])
		// A session that names its organization still gets that sign-in day (parked until the contact is).
		expect(await run(deliver(envelope("session.created", SESSION_ADA), { clerk: broken }))).toEqual([
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
