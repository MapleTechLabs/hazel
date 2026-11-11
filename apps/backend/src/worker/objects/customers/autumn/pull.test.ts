/**
 * The pull: the walk's three phases, the opaque cursor that resumes them, and the `sweep` flag on
 * the last page only (and not after a listing Autumn cut short); live plans priced with their
 * customer, the subscription phase being the only place an ended plan appears; and how Autumn's
 * refusals come back (`auth` stops pulls, a short 429 is waited out, a long one is handed to the
 * alarm, a body Hazel cannot read fails the run).
 */
import type { ConnectionConfig, UpsertSubscription } from "@hazel/domain/customers"
import { Effect, Fiber, Layer, Option, Redacted } from "effect"
import { HttpClient, HttpClientError } from "effect/http"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"
import { WEBHOOK_REQUESTS } from "../provider-http"
import type { PullPage } from "../providers"
import {
	CUSTOMER_ACME,
	CUSTOMER_GLOBEX,
	CUSTOMER_INITECH,
	CUSTOMER_PERSONAL,
	FEATURES,
	ORG_ACME,
	ORGANIZATION,
	ORG_ME,
	PLAN_PRO,
	PLANS,
	SUB_ACME,
	SUB_ACME_ENTITY,
	SUB_ACME_EXPIRED,
	SUB_ACME_SCHEDULED,
	SUB_GLOBEX_TRIAL,
	SUB_INITECH,
} from "./fixtures"
import { makeAutumnApi } from "./http"
import { decodeCursor, encodeCursor, PAGE_SIZE, PLANS_LISTED_PER_CUSTOMER, pullPage } from "./pull"
import { readPricing, SUBSCRIPTIONS_PAGE_SIZE } from "./read"
import { type FakeAutumnState, fakeAutumnHttpClient, makeFakeAutumn } from "./testing"
import { AutumnCustomersPage } from "./wire"

const API_KEY = "am_sk_live_fake0000000000000000"
const CONFIG: ConnectionConfig = { _tag: "autumn", customerIdIsClerkOrgId: true }

const organization = (options: Partial<FakeAutumnState> = {}) =>
	makeFakeAutumn({
		apiKey: API_KEY,
		me: ORG_ME,
		organization: ORGANIZATION,
		features: FEATURES,
		plans: PLANS,
		customers: [CUSTOMER_ACME, CUSTOMER_PERSONAL, CUSTOMER_GLOBEX],
		subscriptions: [SUB_ACME_EXPIRED, SUB_ACME, SUB_GLOBEX_TRIAL, SUB_ACME_SCHEDULED, SUB_ACME_ENTITY],
		...options,
	})

const pageOver = (client: Layer.Layer<HttpClient.HttpClient>, cursor: string | null, apiKey = API_KEY) =>
	Effect.gen(function* () {
		const api = makeAutumnApi(yield* HttpClient.HttpClient, Redacted.make(apiKey))
		return yield* pullPage({ api, pricing: readPricing(api), cursor, config: CONFIG, env: "live" })
	}).pipe(Effect.provide(client))

const page = (fake: FakeAutumnState, cursor: string | null, apiKey = API_KEY) =>
	pageOver(fakeAutumnHttpClient(fake), cursor, apiKey)

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

/** Every page of a whole walk, in order. */
const walk = (fake: FakeAutumnState) =>
	Effect.gen(function* () {
		const pages: Array<PullPage> = []
		let cursor: string | null = null
		do {
			const next: PullPage = yield* page(fake, cursor)
			pages.push(next)
			cursor = next.nextCursor
		} while (cursor !== null && pages.length < 20)
		return pages
	})

/** `total` customers created a millisecond apart, the one at `idless` without an id of its own. */
const listing = (idless: number, total: number) =>
	Array.from({ length: total }, (_, index) => ({
		...CUSTOMER_ACME,
		id: index === idless ? null : `${ORG_ACME}${index}`,
		created_at: CUSTOMER_ACME.created_at + index,
	}))

const tags = (page: PullPage) => page.ops.map((op) => op._tag)

const plansOf = (pages: ReadonlyArray<PullPage>) =>
	pages
		.flatMap((p) => p.ops)
		.filter((op): op is UpsertSubscription => op._tag === "subscription")
		.map((op) => [op.externalId, op.status, op.mrrMinor])

describe("Autumn pull", () => {
	it("walks features, then customers, then subscriptions, and sweeps only at the very end", async () => {
		const fake = organization()
		const pages = await run(walk(fake))
		// The customer listing ends on an empty page: one without a cursor is confirmed by the next.
		expect(pages.map((p) => p.progress.step)).toEqual([
			"features",
			"customers",
			"customers",
			"subscriptions",
		])
		// A metric definition per metered feature; the boolean flag is none.
		expect(tags(pages[0]!)).toEqual(["metric_definition", "metric_definition"])
		// Each customer: the account, then its usage and its live plans.
		expect(tags(pages[1]!).filter((tag) => tag === "account")).toHaveLength(3)
		expect(pages[1]!.progress.done).toBe(3)
		// The sweep rides the last page of the walk, and nothing before it.
		expect(pages.slice(0, -1).every((p) => p.sweep === undefined)).toBe(true)
		expect(pages.at(-1)!.sweep).toEqual(["account", "subscription"])
		expect(fake.calls.map((call) => call.path)).toEqual([
			"/v1/features.list",
			"/v1/customers.list",
			// One pricing lookup per page with a plan to price (the adapter keeps it a few minutes).
			"/v1/plans.list",
			"/v1/organization",
			"/v1/customers.list",
			"/v1/subscriptions.list",
			"/v1/plans.list",
			"/v1/organization",
		])
	})

	it("writes live plans with their customer, and only the ended ones from the subscription listing", async () => {
		const pages = await run(walk(organization()))
		// The scheduled and the entity-scoped plans are skipped.
		expect(plansOf([pages[1]!])).toEqual([
			[`${ORG_ACME}:${SUB_ACME.id}`, "active", 9_900],
			[`${CUSTOMER_GLOBEX.id}:${SUB_GLOBEX_TRIAL.id}`, "trialing", 300_000],
		])
		expect(plansOf([pages.at(-1)!])).toEqual([[`${ORG_ACME}:${SUB_ACME_EXPIRED.id}`, "canceled", 0]])
	})

	it("prices a customer's prepaid units and its own plan, as a delivery does", async () => {
		const custom = { ...SUB_ACME, plan: { ...PLAN_PRO, price: { amount: 49, interval: "month" } } }
		const fake = organization({
			customers: [{ ...CUSTOMER_ACME, subscriptions: [custom] }, CUSTOMER_INITECH],
			subscriptions: [SUB_ACME, SUB_INITECH],
		})
		const pages = await run(walk(fake))
		expect(plansOf(pages)).toEqual([
			[`${ORG_ACME}:${SUB_ACME.id}`, "active", 4_900],
			[`${CUSTOMER_INITECH.id}:main`, "active", 7_000],
		])
		const customers = fake.calls.find((call) => call.path === "/v1/customers.list")!
		expect(customers.body).toEqual({
			start_cursor: "",
			limit: PAGE_SIZE,
			// Oldest first, and each plan as the customer holds it.
			sort_order: "asc",
			expand: ["balances.feature", "subscriptions.plan"],
		})
	})

	it("leaves an ended plan alone when a live one of the same customer reuses its id", async () => {
		const ended = { ...SUB_ACME_EXPIRED, id: SUB_ACME.id }
		const pages = await run(walk(organization({ subscriptions: [SUB_ACME, ended] })))
		expect(pages.at(-1)!.ops).toEqual([])
	})

	it("leaves an ended plan alone when the live one reusing its id was on the page before", async () => {
		const others = Array.from({ length: SUBSCRIPTIONS_PAGE_SIZE - 1 }, (_, index) => ({
			...SUB_INITECH,
			id: `other_${index}`,
			customer_id: `org_other${index}`,
		}))
		const ended = { ...SUB_ACME_EXPIRED, id: SUB_ACME.id }
		const pages = await run(walk(organization({ subscriptions: [...others, SUB_ACME, ended] })))
		const listings = pages.filter((p) => p.progress.step === "subscriptions")
		expect(listings.map((p) => p.progress.done)).toEqual([
			SUBSCRIPTIONS_PAGE_SIZE,
			SUBSCRIPTIONS_PAGE_SIZE + 1,
		])
		expect(plansOf(listings)).toEqual([])
	})

	it("skips an ended plan of a customer without an id of its own (Autumn names its internal id)", async () => {
		const internal = { ...SUB_ACME_EXPIRED, customer_id: "cus_2Pq7Yx3ZbN1kLmVwRtS8uHgJdEf" }
		const pages = await run(walk(organization({ subscriptions: [internal] })))
		expect(plansOf([pages.at(-1)!])).toEqual([])
	})

	it("skips a row it cannot read and does not sweep what that listing holds", async () => {
		const unreadable = { ...CUSTOMER_GLOBEX, created_at: "yesterday" }
		const customers = await run(walk(organization({ customers: [CUSTOMER_ACME, unreadable] })))
		expect(customers[1]!.ops.filter((op) => op._tag === "account")).toHaveLength(1)
		expect(customers.every((p) => p.sweep === undefined)).toBe(true)
		const plans = await run(
			walk(
				organization({
					subscriptions: [SUB_ACME_EXPIRED, { ...SUB_ACME_EXPIRED, id: "bad", plan_id: 5 }],
				}),
			),
		)
		expect(plansOf([plans.at(-1)!])).toEqual([[`${ORG_ACME}:${SUB_ACME_EXPIRED.id}`, "canceled", 0]])
		expect(plans.at(-1)!.sweep).toEqual(["account"])
	})

	it("does not sweep after Autumn dropped a customer it could not serialize from a page", async () => {
		const many = Array.from({ length: PAGE_SIZE + 2 }, (_, index) => ({
			...CUSTOMER_ACME,
			id: `${ORG_ACME}${index}`,
		}))
		const pages = await run(walk(organization({ customers: many, unserializable: [`${ORG_ACME}3`] })))
		expect(pages.filter((p) => p.progress.step === "customers")).toHaveLength(3)
		expect(pages.every((p) => p.sweep === undefined)).toBe(true)
	})

	it("does not sweep after Autumn dropped a customer from a page it sent no cursor for", async () => {
		const accounts = (pages: ReadonlyArray<PullPage>) =>
			pages.flatMap(tags).filter((tag) => tag === "account").length
		// The page ends on an id-less customer, and lost another one it could not serialize.
		const lossy = await run(
			walk(
				organization({
					customers: listing(PAGE_SIZE - 1, PAGE_SIZE + 2),
					unserializable: [`${ORG_ACME}3`],
				}),
			),
		)
		expect(lossy.filter((p) => p.progress.step === "customers")).toHaveLength(3)
		expect(accounts(lossy)).toBe(PAGE_SIZE)
		expect(lossy.every((p) => p.sweep === undefined)).toBe(true)
		// The id-less customer Autumn dropped the cursor on failed to serialize: the page looks like the
		// end, and the customers after it are read from the next one.
		const hidden = await run(
			walk(
				organization({ customers: listing(PAGE_SIZE - 1, PAGE_SIZE + 2), unserializable: ["null"] }),
			),
		)
		expect(hidden.filter((p) => p.progress.step === "customers")).toHaveLength(3)
		expect(accounts(hidden)).toBe(PAGE_SIZE + 1)
		expect(hidden.every((p) => p.sweep === undefined)).toBe(true)
	})

	it("resumes a phase from the cursor it carried", async () => {
		const fake = organization({ customers: [CUSTOMER_ACME, CUSTOMER_PERSONAL, CUSTOMER_GLOBEX] })
		// One customer a page: three pages, each starting after the one before.
		const small = encodeCursor({ phase: "customers", after: null, done: 0 })
		expect(Option.getOrThrow(decodeCursor(small))).toEqual({
			phase: "customers",
			after: null,
			done: 0,
		})
		const first = await run(page(fake, small))
		expect(first.nextCursor).not.toBeNull()
		// Every customer on one page, without a cursor: the listing goes on after the newest one's
		// creation to confirm the end, then the walk moves on to the plans.
		expect(Option.getOrThrow(decodeCursor(first.nextCursor!))).toEqual({
			phase: "customers",
			after: null,
			done: 3,
			from: CUSTOMER_GLOBEX.created_at + 1,
			short: true,
		})
		const second = await run(page(fake, first.nextCursor))
		expect(second.ops).toEqual([])
		expect(Option.getOrThrow(decodeCursor(second.nextCursor!)).phase).toBe("subscriptions")
		const third = await run(page(fake, second.nextCursor))
		expect(third.progress.step).toBe("subscriptions")
	})

	it("pages the customers when Autumn has more than one page of them", async () => {
		const many = Array.from({ length: PAGE_SIZE + 2 }, (_, index) => ({
			...CUSTOMER_ACME,
			id: `${ORG_ACME}${index}`,
		}))
		const fake = organization({ customers: many })
		const pages = await run(walk(fake))
		const customerPages = pages.filter((p) => p.progress.step === "customers")
		expect(customerPages).toHaveLength(3)
		expect(customerPages.map((p) => p.progress.done)).toEqual([PAGE_SIZE, PAGE_SIZE + 2, PAGE_SIZE + 2])
		expect(customerPages[0]!.sweep).toBeUndefined()
		expect(
			fake.calls
				.filter((call) => call.path === "/v1/customers.list")
				.map((call) => call.body["start_cursor"]),
		).toEqual(["", `${ORG_ACME}${PAGE_SIZE - 1}`, ""])
	})

	it("follows `has_more` rather than the row count on the subscriptions page", async () => {
		// Autumn may answer a short page (even an empty one) while more rows remain.
		const fake = organization()
		const atSubscriptions = encodeCursor({ phase: "subscriptions", after: null, done: 0 })
		const only = await run(page(fake, atSubscriptions))
		expect(only.nextCursor).toBeNull()
		expect(only.sweep).toEqual(["account", "subscription"])
	})

	it("goes on from the creation time after an id-less customer Autumn dropped the cursor on", async () => {
		// The page's last customer has no id of its own, so Autumn sends no cursor however many remain.
		const created = CUSTOMER_ACME.created_at
		const fake = organization({ customers: listing(PAGE_SIZE - 1, PAGE_SIZE + 2) })
		const pages = await run(walk(fake))
		const customerPages = pages.filter((p) => p.progress.step === "customers")
		expect(customerPages).toHaveLength(3)
		expect(customerPages.flatMap(tags).filter((tag) => tag === "account")).toHaveLength(PAGE_SIZE + 1)
		expect(
			fake.calls
				.filter((call) => call.path === "/v1/customers.list")
				.map((call) => call.body["created_at_range"]),
		).toEqual([undefined, { start: created + PAGE_SIZE }, { start: created + PAGE_SIZE + 2 }])
		expect(pages.at(-1)!.sweep).toEqual(["account", "subscription"])
		// The newest customer has no id: the listing after it is empty, the real end, and sweeps.
		const newest = await run(walk(organization({ customers: listing(2, 3) })))
		expect(newest.filter((p) => p.progress.step === "customers")).toHaveLength(2)
		expect(newest.at(-1)!.sweep).toEqual(["account", "subscription"])
		// Without a creation time to go on from, the listing stops there and nothing is swept.
		const timeless = listing(PAGE_SIZE - 1, PAGE_SIZE + 2).map((customer) =>
			customer.id === null ? { ...customer, created_at: null } : customer,
		)
		const cut = await run(walk(organization({ customers: timeless })))
		expect(cut.filter((p) => p.progress.step === "customers")).toHaveLength(1)
		expect(cut.every((p) => p.sweep === undefined)).toBe(true)
		// A last page that is simply full, cursor or not, is the end of the listing.
		const exact = Array.from({ length: PAGE_SIZE }, (_, index) => ({
			...CUSTOMER_ACME,
			id: `${ORG_ACME}${index}`,
		}))
		expect((await run(walk(organization({ customers: exact })))).at(-1)!.sweep).toEqual([
			"account",
			"subscription",
		])
	})

	it("sweeps no plans when a customer lists as many as Autumn returns per customer", async () => {
		const crowded = {
			...CUSTOMER_ACME,
			purchases: Array.from({ length: PLANS_LISTED_PER_CUSTOMER - 1 }, (_, index) => ({
				plan_id: `pack_${index}`,
			})),
		}
		const pages = await run(walk(organization({ customers: [crowded, CUSTOMER_GLOBEX] })))
		expect(pages.at(-1)!.sweep).toEqual(["account"])
	})

	it("names a listed metric after its feature, never after its id", async () => {
		const fake = organization()
		const atCustomers = encodeCursor({ phase: "customers", after: null, done: 0 })
		const customers = await run(page(fake, atCustomers))
		// The listing expands the balances' features, as `customers.get` does.
		expect(
			customers.ops.flatMap((op) => (op._tag === "metric_definition" ? [[op.key, op.name]] : [])),
		).toEqual([
			["autumn.messages", "Messages"],
			["autumn.seats", "Seats"],
			["autumn.messages", "Messages"],
		])
	})

	it("skips a customer of another environment than the key opens", async () => {
		const fake = organization({
			customers: [CUSTOMER_ACME, { ...CUSTOMER_GLOBEX, env: "sandbox" }],
		})
		const atCustomers = encodeCursor({ phase: "customers", after: null, done: 0 })
		const customers = await run(page(fake, atCustomers))
		expect(customers.ops.filter((op) => op._tag === "account")).toHaveLength(1)
		// The page still counts the row it read, so the cursor keeps moving.
		expect(customers.progress.done).toBe(2)
	})

	it("starts the walk over when the cursor cannot be read", async () => {
		const fake = organization()
		const fresh = await run(page(fake, "{not json"))
		expect(fresh.progress.step).toBe("features")
	})

	it("stops the connection on a refused key, and fails a page Autumn will refuse again", async () => {
		const refused = await run(Effect.flip(page(organization(), null, "am_sk_live_wrong")))
		expect(refused).toMatchObject({ code: "auth", httpStatus: 401 })
		const invalid = await run(
			Effect.flip(
				page(
					organization({ invalid: ["/v1/customers.list"] }),
					encodeCursor({ phase: "customers", after: null }),
				),
			),
		)
		expect(invalid).toMatchObject({ code: "provider", retryable: false, httpStatus: 400 })
	})

	it("retries a 5xx through core's backoff, and fails a body it cannot read", async () => {
		const failing = await run(Effect.flip(page(organization({ failing: ["/v1/features.list"] }), null)))
		expect(failing).toMatchObject({ code: "provider", httpStatus: 503 })
		expect(failing.retryable).toBeUndefined()
		const garbled = await run(Effect.flip(page(organization({ garbled: ["/v1/features.list"] }), null)))
		expect(garbled).toMatchObject({ code: "provider", retryable: false })
		expect(garbled.message).toMatch(/body Hazel cannot read/)
	})

	it("waits out a short Retry-After in place", async () => {
		const fake = organization({ throttleAfter: 0, retryAfterSeconds: 1 })
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

	it("gives up after its own retries when Autumn keeps throttling", async () => {
		const fake = organization({ throttleAfter: 0, retryAfterSeconds: 1 })
		const error = await run(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(Effect.flip(page(fake, null)))
				yield* TestClock.adjust(10_000)
				return yield* Fiber.join(fiber)
			}).pipe(Effect.provide(TestClock.layer())),
		)
		expect(error.code).toBe("rate_limited")
		// The first attempt and its two retries.
		expect(fake.throttled).toBe(3)
	})

	it("hands a long Retry-After to the alarm as `rate_limited`, without waiting", async () => {
		const fake = organization({ throttleAfter: 0, retryAfterSeconds: 120 })
		const error = await run(Effect.flip(page(fake, null)))
		expect(error.code).toBe("rate_limited")
		expect(error.retryAfterMs).toBe(120_000)
		expect(fake.throttled).toBe(1)
	})

	it("never waits out a 429 on the webhook path", async () => {
		const fake = organization({ throttleAfter: 0, retryAfterSeconds: 1 })
		const error = await run(
			Effect.gen(function* () {
				const api = makeAutumnApi(
					yield* HttpClient.HttpClient,
					Redacted.make(API_KEY),
					WEBHOOK_REQUESTS,
				)
				return yield* Effect.flip(api.post("/v1/customers.list", {}, AutumnCustomersPage))
			}).pipe(Effect.provide(fakeAutumnHttpClient(fake))),
		)
		expect(error.code).toBe("rate_limited")
		expect(fake.throttled).toBe(1)
	})

	it("reports an unreachable Autumn as `network`, retryable", async () => {
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
			message: "Could not reach Autumn (TransportError)",
		})
		expect(error.retryable).toBeUndefined()
	})
})
