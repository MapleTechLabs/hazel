/**
 * The backfill sweep: its three phases, the cursor that resumes them, the one batched users request
 * per membership page, and how Clerk's refusals come back (`auth` stops pulls, a short 429 is
 * waited out, a long one is handed to the alarm).
 */
import type { ConnectionConfig, IngestOp, UpsertAccount } from "@hazel/domain/customers"
import { Effect } from "effect"
import { HttpClient } from "effect/http"
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
import { decodeCursor, encodeCursor, PAGE_SIZE, pullPage } from "./pull"
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

const page = (fake: FakeClerkState, cursor: string | null, apiKey = API_KEY) =>
	Effect.gen(function* () {
		const get = makeClerkGet(yield* HttpClient.HttpClient, apiKey)
		return yield* pullPage({ get, cursor, config: CONFIG })
	}).pipe(Effect.provide(fakeClerkHttpClient(fake)))

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
const tags = (ops: ReadonlyArray<IngestOp>) => ops.map((op) => op._tag)

/** Walk the whole sweep, as the alarm does: each page's `nextCursor` drives the next call. */
const sweep = async (fake: FakeClerkState) => {
	const pages: Array<{ cursor: string | null; ops: ReadonlyArray<IngestOp>; step: string }> = []
	let cursor: string | null = null
	for (let guard = 0; guard < 20; guard++) {
		const result: PullPage = await run(page(fake, cursor))
		pages.push({ cursor, ops: result.ops, step: result.progress.step })
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
		expect(paramsOf("/organizations")).toEqual([
			["limit", "100"],
			["offset", "0"],
			["include_members_count", "true"],
		])
		expect(paramsOf("/organization_domains")).toEqual([
			["limit", "100"],
			["offset", "0"],
			["verified", "true"],
		])
		expect(paramsOf("/users")).toEqual([
			["limit", "100"],
			["user_id", USER_ADA.id],
			["user_id", USER_GRACE.id],
		])
	})

	it("writes the accounts, then the members with their activity, then the merged domains", async () => {
		const [organizations, members, domains] = await sweep(instance())
		expect(tags(organizations!.ops)).toEqual(["account", "account"])

		// Both organizations once each, before any contact that names them.
		expect(tags(members!.ops)).toEqual([
			"account",
			"account",
			"contact",
			"activity",
			"activity",
			"contact",
			"contact",
			"activity",
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
				onNoMatch: "unmatched",
			} satisfies UpsertAccount,
		])
	})

	it("reports progress against Clerk's total so the UI can show a backfill moving", async () => {
		const result = await run(page(instance(), null))
		expect(result.progress).toEqual({ step: "organizations", done: 2, total: 2 })
	})

	it("pages a phase until Clerk runs out, carrying the offset in the cursor", async () => {
		const many = Array.from({ length: PAGE_SIZE + 20 }, (_, index) => ({
			...ORG_GLOBEX,
			id: `org_${String(index).padStart(20, "0")}`,
		}))
		const fake = instance({ organizations: many })
		const first = await run(page(fake, null))
		expect(first.ops).toHaveLength(PAGE_SIZE)
		expect(first.nextCursor).toBe(encodeCursor({ phase: "organizations", offset: PAGE_SIZE }))
		const second = await run(page(fake, first.nextCursor))
		expect(second.ops).toHaveLength(20)
		expect(second.progress).toEqual({
			step: "organizations",
			done: PAGE_SIZE + 20,
			total: PAGE_SIZE + 20,
		})
		expect(second.nextCursor).toBe(encodeCursor({ phase: "members", offset: 0 }))
		expect(fake.calls.map((call) => call.params.find(([key]) => key === "offset")?.[1])).toEqual([
			"0",
			"100",
		])
	})

	it("skips the users request for a membership page with no public user data", async () => {
		const fake = instance({ memberships: [{ ...MEMBERSHIP_ADA_GLOBEX, public_user_data: undefined }] })
		const result = await run(page(fake, encodeCursor({ phase: "members", offset: 0 })))
		expect(fake.calls.map((call) => call.path)).toEqual(["/organization_memberships"])
		expect(tags(result.ops)).toEqual(["account"])
	})

	it("restarts the sweep from a cursor it cannot read, rather than failing the run", () => {
		expect(decodeCursor(null)).toEqual({ phase: "organizations", offset: 0 })
		expect(decodeCursor("{")).toEqual({ phase: "organizations", offset: 0 })
		expect(decodeCursor('{"phase":"invoices","offset":0}')).toEqual({ phase: "organizations", offset: 0 })
		expect(decodeCursor('{"phase":"members","offset":-1}')).toEqual({ phase: "organizations", offset: 0 })
		expect(decodeCursor('{"phase":"domains","offset":300}')).toEqual({ phase: "domains", offset: 300 })
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

	it("waits out a short Retry-After and finishes the page", async () => {
		const fake = instance({ throttleAfter: 0, retryAfterSeconds: 1 })
		const pending = run(page(fake, null))
		// The first call is throttled; the retry lands once the fake stops throttling.
		await new Promise((resolve) => setTimeout(resolve, 10))
		fake.throttleAfter = null
		const result = await pending
		expect(fake.throttled).toBe(1)
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
		const error = await run(Effect.flip(page(fake, null)))
		expect(error.code).toBe("rate_limited")
		expect(fake.throttled).toBe(3)
	})

	it("sends the secret key only in the Authorization header", async () => {
		const fake = instance()
		await sweep(fake)
		expect(new Set(fake.authHeaders)).toEqual(new Set([`Bearer ${API_KEY}`]))
		expect(JSON.stringify(fake.calls)).not.toContain(API_KEY)
	})
})
