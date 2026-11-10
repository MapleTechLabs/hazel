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
	MEMBERSHIP_ADA_ADMIN,
	MEMBERSHIP_ADA_GLOBEX,
	MS,
	ORG_ACME,
	ORG_GLOBEX,
	SESSION_ADA,
	SESSION_ADA_NO_ORG,
	USER_ADA,
} from "./fixtures"
import { makeClerkGet } from "./http"
import { fakeClerkHttpClient, makeFakeClerk } from "./testing"
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
const getOf = Effect.map(HttpClient.HttpClient, (client) => makeClerkGet(client, API_KEY))

const deliver = (
	body: string,
	options: {
		readonly secret?: string | null
		readonly tamper?: boolean
		readonly timestampMs?: number
		readonly createAccounts?: boolean
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
			webhookSecret: options.secret === null ? null : Redacted.make(options.secret ?? SECRET),
			onNoMatch: options.createAccounts === false ? "unmatched" : "create",
		})
	}).pipe(Effect.provide(fakeClerkHttpClient(fake)))

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
const tags = (ops: ReadonlyArray<IngestOp>) => ops.map((op) => op._tag)

describe("Clerk webhook verification", () => {
	it("accepts a delivery Clerk signed", async () => {
		const ops = await run(deliver(envelope("organization.updated", ORG_ACME)))
		expect(tags(ops)).toEqual(["account"])
	})

	it("refuses a tampered body, a wrong secret, a connection with no secret and a replay", async () => {
		const body = envelope("organization.updated", ORG_ACME)
		expect((await run(Effect.flip(deliver(body, { tamper: true })))).message).toMatch(/signature/i)
		expect(
			(await run(Effect.flip(deliver(body, { secret: "whsec_AAAAAAAAAAAAAAAAAAAAAA==" })))).message,
		).toMatch(/signature/i)
		expect((await run(Effect.flip(deliver(body, { secret: null })))).message).toMatch(/signing secret/i)
		expect(
			(await run(Effect.flip(deliver(body, { timestampMs: nowMs() - 10 * 60_000 })))).message,
		).toMatch(/replay window/i)
	})

	it("refuses a body that is not JSON, and one that is not a Clerk envelope", async () => {
		expect((await run(Effect.flip(deliver("not json")))).message).toMatch(/not JSON/i)
		expect((await run(Effect.flip(deliver(JSON.stringify({ hello: "world" }))))).message).toMatch(
			/envelope/i,
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

	it("organizationMembership.deleted removes the contact (ingest raises contact.removed)", async () => {
		const ops = await run(deliver(envelope("organizationMembership.deleted", MEMBERSHIP_ADA_ADMIN)))
		expect((ops[1] as UpsertContact).removed).toBe(true)
	})

	it("user.updated writes one contact per membership the payload carries, with no extra request", async () => {
		const before = fake.calls.length
		const ops = await run(
			deliver(
				envelope("user.updated", {
					...USER_ADA,
					organization_memberships: [MEMBERSHIP_ADA_ADMIN, MEMBERSHIP_ADA_GLOBEX],
				}),
			),
		)
		expect(fake.calls.length).toBe(before)
		const contacts = ops.filter((op): op is UpsertContact => op._tag === "contact")
		expect(contacts.map((contact) => contact.account.externalId)).toEqual([ORG_ACME.id, ORG_GLOBEX.id])
		// The same payload also refreshes both accounts and both days of activity.
		expect(tags(ops)).toEqual([
			"account",
			"contact",
			"activity",
			"activity",
			"account",
			"contact",
			"activity",
			"activity",
		])
	})

	it("user.created for a user with no organization yet writes nothing", async () => {
		expect(
			await run(deliver(envelope("user.created", { ...USER_ADA, organization_memberships: [] }))),
		).toEqual([])
	})

	it("user.deleted is verified and acknowledged; the membership events remove the contacts", async () => {
		expect(
			await run(deliver(envelope("user.deleted", { object: "user", id: USER_ADA.id, deleted: true }))),
		).toEqual([])
	})

	it("session.created credits the day to the session's organization", async () => {
		const ops = await run(deliver(envelope("session.created", SESSION_ADA)))
		expect(ops).toEqual([
			{
				_tag: "activity",
				contact: { provider: "clerk", externalId: USER_ADA.id },
				account: { provider: "clerk", externalId: ORG_ACME.id },
				day: "2026-11-10",
				sessionCount: 1,
				signedIn: true,
			},
			{
				_tag: "contact",
				externalId: USER_ADA.id,
				account: { provider: "clerk", externalId: ORG_ACME.id },
				lastSignInAt: "2026-11-10T08:21:00.000Z",
				lastSeenAt: "2026-11-10T08:21:00.000Z",
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

	it("session.created still succeeds when that request fails, rather than being retried forever", async () => {
		const broken = makeFakeClerk({ secretKey: "sk_test_a_different_key", users: [USER_ADA] })
		const ops = await run(
			Effect.gen(function* () {
				const timestamp = String(Math.floor(nowMs() / 1000))
				const body = envelope("session.created", SESSION_ADA_NO_ORG)
				const signature = yield* signSvix(SECRET, MSG_ID, timestamp, body)
				return yield* receiveWebhook({
					get: makeClerkGet(yield* HttpClient.HttpClient, API_KEY),
					headers: {
						"svix-id": MSG_ID,
						"svix-timestamp": timestamp,
						"svix-signature": `v1,${signature}`,
					},
					body,
					webhookSecret: Redacted.make(SECRET),
					onNoMatch: "create",
				})
			}).pipe(Effect.provide(fakeClerkHttpClient(broken))),
		)
		expect(ops).toEqual([])
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
