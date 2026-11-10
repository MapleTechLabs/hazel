/**
 * The backfill sweep: its three phases, the cursor that resumes them, the one batched users request
 * per membership page, the `sweep` flag on its last page, and how Clerk's refusals come back
 * (`auth` stops pulls, a short 429 is waited out, a long one is handed to the alarm, a body Hazel
 * cannot read fails the run).
 */
import type { ConnectionConfig, IngestOp, UpsertAccount } from "@hazel/domain/customers"
import { Effect, Fiber, Layer, Option, Redacted } from "effect"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import type { PullPage } from "../providers"
import { describe, expect, it } from "vitest"
import {
	DOMAIN_ACME,
	DOMAIN_ACME_EU,
	MEMBERSHIP_ADA_ADMIN,
	MEMBERSHIP_ADA_GLOBEX,
	MEMBERSHIP_GRACE_MEMBER,
	ORG_ACME,
	ORG_GLOBEX,
	USER_ADA,
	USER_GRACE,
} from "./fixtures"
import { makeClerkGet } from "./http"
import { decodeCursor, encodeCursor, PAGE_OVERLAP, PAGE_SIZE, pullPage } from "./pull"
import { type FakeClerkState, fakeClerkHttpClient, makeFakeClerk } from "./testing"

const API_KEY = "sk_test_fake000000000000000000"
const CONFIG: ConnectionConfig = { _tag: "clerk", createAccounts: true }

const instance = (options: Partial<FakeClerkState> = {}) =>
	makeFakeClerk({
		secretKey: API_KEY,
		organizations: [ORG_ACME, ORG_GLOBEX],
		memberships: [MEMBERSHIP_ADA_ADMIN, MEMBERSHIP_GRACE_MEMBER, MEMBERSHIP_ADA_GLOBEX],
		domains: [DOMAIN_ACME, DOMAIN_ACME_EU],
		users: [USER_ADA, USER_GRACE],
		...options,
	})

const pageOver = (client: Layer.Layer<HttpClient.HttpClient>, cursor: string | null, apiKey = API_KEY) =>
	Effect.gen(function* () {
		const get = makeClerkGet(yield* HttpClient.HttpClient, Redacted.make(apiKey))
		return yield* pullPage({ get, cursor, config: CONFIG })
	}).pipe(Effect.provide(client))

const page = (fake: FakeClerkState, cursor: string | null, apiKey = API_KEY) =>
	pageOver(fakeClerkHttpClient(fake), cursor, apiKey)

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

/** A Clerk that answers every request with `respond()`. */
const answering = (respond: () => Response) =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request) => Effect.sync(() => HttpClientResponse.fromWeb(request, respond()))),
	)
const tags = (ops: ReadonlyArray<IngestOp>) => ops.map((op) => op._tag)

/** `count` organizations, oldest first, each created a millisecond after the one before. */
const organizations = (count: number) =>
	Array.from({ length: count }, (_, index) => ({
		...ORG_GLOBEX,
		id: `org_${String(index).padStart(20, "0")}`,
		created_at: ORG_GLOBEX.created_at + index,
	}))

/** Walk the whole sweep, as the alarm does: each page's `nextCursor` drives the next call. */
const sweep = async (fake: FakeClerkState) => {
	const pages: Array<{
		cursor: string | null
		ops: ReadonlyArray<IngestOp>
		step: string
		sweep: PullPage["sweep"]
	}> = []
	let cursor: string | null = null
	for (let guard = 0; guard < 20; guard++) {
		const result: PullPage = await run(page(fake, cursor))
		pages.push({ cursor, ops: result.ops, step: result.progress.step, sweep: result.sweep })
		if (result.nextCursor === null) return pages
		cursor = result.nextCursor
	}
	throw new Error("the sweep did not finish")
}

describe("the Clerk sweep", () => {
	it("walks organizations, then members, then domains, and stops", async () => {
		const fake = instance()
		const pages = await sweep(fake)
		expect(pages.map((entry) => entry.step)).toEqual(["organizations", "members", "domains"])
		expect(fake.calls.map((call) => call.path)).toEqual([
			"/organizations",
			"/organization_memberships",
			// One batched request for the hundred users behind the membership page.
			"/users",
			"/organization_domains",
		])
	})

	it("asks for member counts, verified domains only, and the page's users in one request", async () => {
		const fake = instance()
		await sweep(fake)
		const paramsOf = (path: string) => fake.calls.find((call) => call.path === path)!.params
		// Every listing oldest first, so a record created mid-sweep cannot shift the rows not read yet.
		const paging = [
			["limit", "100"],
			["offset", "0"],
			["order_by", "+created_at"],
		]
		expect(paramsOf("/organizations")).toEqual([...paging, ["include_members_count", "true"]])
		expect(paramsOf("/organization_memberships")).toEqual(paging)
		expect(paramsOf("/organization_domains")).toEqual([...paging, ["verified", "true"]])
		expect(paramsOf("/users")).toEqual([
			["limit", "100"],
			["user_id", USER_ADA.id],
			["user_id", USER_GRACE.id],
		])
	})

	it("writes the accounts, then the members, then the merged domains", async () => {
		const [organizations, members, domains] = await sweep(instance())
		expect(tags(organizations!.ops)).toEqual(["account", "account"])

		// Both organizations once each, before any contact that names them; each contact before its
		// last active day (Grace has none).
		expect(tags(members!.ops)).toEqual([
			"account",
			"account",
			"contact",
			"activity",
			"contact",
			"contact",
			"activity",
		])
		expect(
			members!.ops
				.filter((op): op is UpsertAccount => op._tag === "account")
				.map((op) => op.externalId),
		).toEqual([ORG_ACME.id, ORG_GLOBEX.id])

		expect(domains!.ops).toEqual([
			{
				_tag: "account",
				externalId: ORG_ACME.id,
				domains: ["acme.com", "acme.eu"],
				sameAs: [],
				// Merged into the account; never a reason to match one (no `matchByDomain`).
				onNoMatch: "unmatched",
				observedAt: expect.any(String),
			},
		])
	})

	it("asks core to remove what it did not see only on the last page of the sweep", async () => {
		const pages = await sweep(instance())
		expect(pages.map((entry) => entry.sweep)).toEqual([undefined, undefined, ["account", "contact"]])
	})

	it("stamps its account and contact ops with the time it asked Clerk", async () => {
		const [organizations, members] = await sweep(instance())
		const observed = [...organizations!.ops, ...members!.ops]
			.filter((op) => op._tag === "account" || op._tag === "contact")
			.map((op) => (op as { observedAt?: string }).observedAt)
		expect(observed.length).toBeGreaterThan(0)
		for (const at of observed) expect(Date.now() - Date.parse(at!)).toBeLessThan(60_000)
	})

	it("reports progress against Clerk's total so the UI can show a backfill moving", async () => {
		const result = await run(page(instance(), null))
		expect(result.progress).toEqual({ step: "organizations", done: 2, total: 2 })
	})

	it("pages a phase until Clerk runs out, re-reading the last rows of the page before", async () => {
		const many = organizations(PAGE_SIZE + 20)
		const fake = instance({ organizations: many })
		const first = await run(page(fake, null))
		expect(first.ops).toHaveLength(PAGE_SIZE)
		expect(first.sweep).toBeUndefined()
		expect(first.nextCursor).toBe(
			encodeCursor({ phase: "organizations", offset: PAGE_SIZE, lastId: many[PAGE_SIZE - 1]!.id }),
		)
		const second = await run(page(fake, first.nextCursor))
		expect(second.ops).toHaveLength(20 + PAGE_OVERLAP)
		expect(second.progress).toEqual({
			step: "organizations",
			done: PAGE_SIZE + 20,
			total: PAGE_SIZE + 20,
		})
		expect(second.nextCursor).toBe(encodeCursor({ phase: "members", offset: 0 }))
		expect(fake.calls.map((call) => call.params.find(([key]) => key === "offset")?.[1])).toEqual([
			"0",
			String(PAGE_SIZE - PAGE_OVERLAP),
		])
	})

	it("sees every organization when some are deleted mid-sweep", async () => {
		const many = organizations(PAGE_SIZE + 20)
		const fake = instance({ organizations: many })
		const first = await run(page(fake, null))
		// Three organizations of the first page are deleted before the second is asked for.
		const remaining = many.filter((_, index) => index < 3 || index >= 6)
		const second = await run(page(instance({ organizations: remaining }), first.nextCursor))
		const seen = new Set([...first.ops, ...second.ops].map((op) => (op as UpsertAccount).externalId))
		expect(remaining.every((org) => seen.has(org.id))).toBe(true)
		// The overlap covered the shift, so the sweep stays whole.
		expect(second.nextCursor).toBe(encodeCursor({ phase: "members", offset: 0 }))
	})

	it("removes nothing at the end of a sweep when more rows were deleted than the overlap re-reads", async () => {
		const many = organizations(PAGE_SIZE + 20)
		const first = await run(page(instance({ organizations: many }), null))
		// More deletions before the cursor than the overlap: rows shifted past the next page's start.
		const remaining = many.filter((_, index) => index < 3 || index > PAGE_OVERLAP + 3)
		const fake = instance({ organizations: remaining })
		const second = await run(page(fake, first.nextCursor))
		expect(second.nextCursor).toBe(encodeCursor({ phase: "members", offset: 0, partial: true }))
		const members = await run(page(fake, second.nextCursor))
		const domains = await run(page(fake, members.nextCursor))
		expect(domains.nextCursor).toBeNull()
		expect(domains.sweep).toBeUndefined()
	})

	it("removes nothing at the end of a sweep whose page ends in more same-millisecond rows than it re-reads", async () => {
		// Clerk orders rows created in the same millisecond no fixed way: the next request may list
		// one of the tied rows before the ones it re-reads.
		const many = organizations(PAGE_SIZE + 20).map((org, index) =>
			index >= PAGE_SIZE - PAGE_OVERLAP
				? { ...org, created_at: ORG_GLOBEX.created_at + PAGE_SIZE }
				: org,
		)
		const fake = instance({ organizations: many })
		const first = await run(page(fake, null))
		expect(first.nextCursor).toBe(
			encodeCursor({
				phase: "organizations",
				offset: PAGE_SIZE,
				lastId: many[PAGE_SIZE - 1]!.id,
				partial: true,
			}),
		)
		// Fewer ties than the overlap are re-read whole: the sweep stays complete.
		const fewer = organizations(PAGE_SIZE + 20).map((org, index) =>
			index >= PAGE_SIZE - PAGE_OVERLAP + 1
				? { ...org, created_at: ORG_GLOBEX.created_at + PAGE_SIZE }
				: org,
		)
		const whole = await run(page(instance({ organizations: fewer }), null))
		expect(decodeCursor(whole.nextCursor)).toEqual(
			Option.some({ phase: "organizations", offset: PAGE_SIZE, lastId: fewer[PAGE_SIZE - 1]!.id }),
		)
	})

	it("skips the users request for a membership page with no public user data", async () => {
		const fake = instance({ memberships: [{ ...MEMBERSHIP_ADA_GLOBEX, public_user_data: undefined }] })
		const result = await run(page(fake, encodeCursor({ phase: "members", offset: 0 })))
		expect(fake.calls.map((call) => call.path)).toEqual(["/organization_memberships"])
		expect(tags(result.ops)).toEqual(["account"])
	})

	it("reads a cursor, and knows one it cannot read", () => {
		expect(decodeCursor(null)).toEqual(Option.some({ phase: "organizations", offset: 0 }))
		expect(decodeCursor("{")).toEqual(Option.none())
		expect(decodeCursor('{"phase":"invoices","offset":0}')).toEqual(Option.none())
		expect(decodeCursor('{"phase":"members","offset":-1}')).toEqual(Option.none())
		expect(decodeCursor('{"phase":"domains","offset":300}')).toEqual(
			Option.some({ phase: "domains", offset: 300 }),
		)
	})

	it("restarts the sweep from a cursor it cannot read, rather than failing the run", async () => {
		const fake = instance()
		const result = await run(page(fake, "{"))
		expect(result.progress.step).toBe("organizations")
		expect(fake.calls.map((call) => call.path)).toEqual(["/organizations"])
	})
})

describe("when Clerk refuses", () => {
	it("reports a rejected key as `auth`, which stops scheduled pulls", async () => {
		const error = await run(Effect.flip(page(instance(), null, "sk_test_wrong")))
		expect(error.code).toBe("auth")
		expect(error.httpStatus).toBe(401)
		// Clerk's own explanation reaches the UI; the key never does.
		expect(error.message).toMatch(/Clerk rejected the secret key \(401\)/)
		expect(error.message).not.toContain("sk_test_wrong")
	})

	it("truncates Clerk's explanation of a refused key, and keeps it out of any other refusal", async () => {
		const refusing = (status: number) =>
			answering(() => Response.json({ errors: [{ long_message: "x".repeat(1_000) }] }, { status }))
		const auth = await run(Effect.flip(pageOver(refusing(401), null)))
		expect(auth.message.length).toBeLessThan(300)
		const other = await run(Effect.flip(pageOver(refusing(422), null)))
		expect(other.message).toBe("Clerk refused GET /organizations (422)")
	})

	it("waits out a short Retry-After and finishes the page", async () => {
		const fake = instance({ throttleAfter: 0, retryAfterSeconds: 1 })
		const result = await run(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(page(fake, null))
				// The first call is throttled; the retry lands once the fake stops throttling.
				yield* TestClock.adjust(500)
				expect(fake.throttled).toBe(1)
				fake.throttleAfter = null
				yield* TestClock.adjust(500)
				return yield* Fiber.join(fiber)
			}).pipe(Effect.provide(TestClock.layer())),
		)
		expect(fake.throttled).toBe(1)
		expect(fake.calls).toHaveLength(2)
		expect(result.ops).toHaveLength(2)
	})

	it("hands a long Retry-After to the alarm as `rate_limited`, without waiting", async () => {
		const fake = instance({ throttleAfter: 0, retryAfterSeconds: 120 })
		const error = await run(Effect.flip(page(fake, null)))
		expect(error.code).toBe("rate_limited")
		expect(error.retryAfterMs).toBe(120_000)
		expect(fake.throttled).toBe(1)
	})

	it("gives up after its own retries when Clerk keeps throttling", async () => {
		const fake = instance({ throttleAfter: 0, retryAfterSeconds: 1 })
		const error = await run(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(Effect.flip(page(fake, null)))
				// A second at a time, so each retry's sleep is reached before the clock passes it.
				for (let second = 0; second < 5; second++) yield* TestClock.adjust(1_000)
				return yield* Fiber.join(fiber)
			}).pipe(Effect.provide(TestClock.layer())),
		)
		expect(error.code).toBe("rate_limited")
		expect(fake.throttled).toBe(3)
	})

	it("maps a 5xx to a retryable `provider` failure", async () => {
		const error = await run(
			Effect.flip(
				pageOver(
					answering(() => Response.json({}, { status: 502 })),
					null,
				),
			),
		)
		expect(error).toMatchObject({ code: "provider", httpStatus: 502 })
		expect(error.retryable).toBeUndefined()
	})

	it("maps an unreachable Clerk to a retryable `network` failure", async () => {
		const unreachable = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request) =>
				Effect.fail(
					new HttpClientError.HttpClientError({
						reason: new HttpClientError.TransportError({
							request,
							description: "connection reset",
						}),
					}),
				),
			),
		)
		const error = await run(Effect.flip(pageOver(unreachable, null)))
		expect(error).toMatchObject({
			code: "network",
			httpStatus: null,
			message: "Could not reach Clerk (TransportError)",
		})
	})

	it("maps a Clerk that does not answer in time to a retryable `network` failure", async () => {
		const silent = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make(() => Effect.never),
		)
		const error = await run(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(Effect.flip(pageOver(silent, null)))
				yield* TestClock.adjust(30_000)
				return yield* Fiber.join(fiber)
			}).pipe(Effect.provide(TestClock.layer())),
		)
		expect(error).toMatchObject({
			code: "network",
			httpStatus: null,
			message: "Clerk did not answer GET /organizations within 30 s",
		})
		expect(error.retryable).toBeUndefined()
	})

	it("fails the run, without retrying, on a body it cannot read", async () => {
		const notJson = await run(
			Effect.flip(
				pageOver(
					answering(() => new Response("<html>", { status: 200 })),
					null,
				),
			),
		)
		expect(notJson).toMatchObject({ code: "provider", retryable: false })
		const renamedField = await run(
			Effect.flip(
				pageOver(
					answering(() => Response.json({ data: [{ name: "No id" }] })),
					null,
				),
			),
		)
		expect(renamedField).toMatchObject({ code: "provider", httpStatus: 200, retryable: false })
		expect(renamedField.message).toMatch(/GET \/organizations with a body Hazel cannot read/)
		// The body's values never reach the message.
		expect(renamedField.message).not.toContain("No id")
	})

	it("sends the secret key only in the Authorization header", async () => {
		const fake = instance()
		await sweep(fake)
		expect(new Set(fake.authHeaders)).toEqual(new Set([`Bearer ${API_KEY}`]))
		expect(JSON.stringify(fake.calls)).not.toContain(API_KEY)
	})
})
