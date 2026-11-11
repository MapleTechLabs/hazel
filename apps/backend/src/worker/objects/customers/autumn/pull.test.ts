/**
 * The pull: the walk's three phases, the opaque cursor that resumes them, and the `sweep` flag on
 * the last page only; the subscription phase being the only place an ended plan appears; and how
 * Autumn's refusals come back (`auth` stops pulls, a short 429 is waited out, a long one is handed
 * to the alarm, a body Hazel cannot read fails the run).
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
	CUSTOMER_PERSONAL,
	FEATURES,
	ORG_ACME,
	ORGANIZATION,
	ORG_ME,
	PLANS,
	SUB_ACME,
	SUB_ACME_ENTITY,
	SUB_ACME_EXPIRED,
	SUB_ACME_SCHEDULED,
	SUB_GLOBEX_TRIAL,
} from "./fixtures"
import { makeAutumnApi } from "./http"
import { decodeCursor, encodeCursor, PAGE_SIZE, pullPage } from "./pull"
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
		customers: [CUSTOMER_ACME, CUSTOMER_GLOBEX, CUSTOMER_PERSONAL],
		subscriptions: [SUB_ACME_EXPIRED, SUB_ACME, SUB_GLOBEX_TRIAL, SUB_ACME_SCHEDULED, SUB_ACME_ENTITY],
		...options,
	})

const pageOver = (client: Layer.Layer<HttpClient.HttpClient>, cursor: string | null, apiKey = API_KEY) =>
	Effect.gen(function* () {
		const api = makeAutumnApi(yield* HttpClient.HttpClient, Redacted.make(apiKey))
		return yield* pullPage({ api, cursor, config: CONFIG, env: "live" })
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

const tags = (page: PullPage) => page.ops.map((op) => op._tag)

describe("Autumn pull", () => {
	it("walks features, then customers, then subscriptions, and sweeps only at the very end", async () => {
		const fake = organization()
		const pages = await run(walk(fake))
		expect(pages.map((p) => p.progress.step)).toEqual(["features", "customers", "subscriptions"])
		// A metric definition per metered feature; the boolean flag is none.
		expect(tags(pages[0]!)).toEqual(["metric_definition", "metric_definition"])
		// Each customer: the account, then its usage.
		expect(tags(pages[1]!).filter((tag) => tag === "account")).toHaveLength(3)
		expect(pages[1]!.progress.done).toBe(3)
		// The sweep rides the last page of the walk, and nothing before it.
		expect(pages.slice(0, -1).every((p) => p.sweep === undefined)).toBe(true)
		expect(pages.at(-1)!.sweep).toEqual(["account"])
		expect(fake.calls.map((call) => call.path)).toEqual([
			"/v1/features.list",
			"/v1/customers.list",
			"/v1/subscriptions.list",
			// One pricing lookup for the whole page: the plans and the currency they are quoted in.
			"/v1/plans.list",
			"/v1/organization",
		])
	})

	it("asks for every plan state, so an ended plan is the churn a pull can see", async () => {
		const pages = await run(walk(organization()))
		const subscriptions = pages
			.at(-1)!
			.ops.filter((op): op is UpsertSubscription => op._tag === "subscription")
		// The expired and the two live ones; the scheduled and the entity-scoped one are skipped.
		expect(subscriptions.map((op) => [op.externalId, op.status, op.mrrMinor])).toEqual([
			[SUB_ACME_EXPIRED.id, "canceled", 0],
			[SUB_ACME.id, "active", 9_900],
			[SUB_GLOBEX_TRIAL.id, "trialing", 300_000],
		])
	})

	it("lists oldest first and follows Autumn's own cursor", async () => {
		const fake = organization()
		await run(walk(fake))
		const customers = fake.calls.find((call) => call.path === "/v1/customers.list")!
		expect(customers.body).toEqual({ start_cursor: "", limit: PAGE_SIZE, sort_order: "asc" })
	})

	it("resumes a phase from the cursor it carried", async () => {
		const fake = organization({ customers: [CUSTOMER_ACME, CUSTOMER_GLOBEX, CUSTOMER_PERSONAL] })
		// One customer a page: three pages, each starting after the one before.
		const small = encodeCursor({ phase: "customers", after: null, done: 0 })
		expect(Option.getOrThrow(decodeCursor(small))).toEqual({
			phase: "customers",
			after: null,
			done: 0,
		})
		const first = await run(page(fake, small))
		expect(first.nextCursor).not.toBeNull()
		const resumed = Option.getOrThrow(decodeCursor(first.nextCursor!))
		// A full page of customers is one page here, so the walk moves straight on to the plans.
		expect(resumed.phase).toBe("subscriptions")
		const second = await run(page(fake, first.nextCursor))
		expect(second.progress.step).toBe("subscriptions")
	})

	it("pages the customers when Autumn has more than one page of them", async () => {
		const many = Array.from({ length: PAGE_SIZE + 2 }, (_, index) => ({
			...CUSTOMER_ACME,
			id: `${ORG_ACME}${index}`,
		}))
		const fake = organization({ customers: many })
		const pages = await run(walk(fake))
		const customerPages = pages.filter((p) => p.progress.step === "customers")
		expect(customerPages).toHaveLength(2)
		expect(customerPages.map((p) => p.progress.done)).toEqual([PAGE_SIZE, PAGE_SIZE + 2])
		expect(customerPages[0]!.sweep).toBeUndefined()
		expect(
			fake.calls
				.filter((call) => call.path === "/v1/customers.list")
				.map((call) => call.body["start_cursor"]),
		).toEqual(["", `${ORG_ACME}${PAGE_SIZE - 1}`])
	})

	it("follows `has_more` rather than the row count on the subscriptions page", async () => {
		// Autumn may answer a short page (even an empty one) while more rows remain.
		const fake = organization()
		const atSubscriptions = encodeCursor({ phase: "subscriptions", after: null, done: 0 })
		const only = await run(page(fake, atSubscriptions))
		expect(only.nextCursor).toBeNull()
		expect(only.sweep).toEqual(["account"])
	})

	it("leaves the feature phase's metric names alone: a listed balance carries none", async () => {
		const fake = organization()
		const atCustomers = encodeCursor({ phase: "customers", after: null, done: 0 })
		const customers = await run(page(fake, atCustomers))
		// `customers.list` takes no `expand`, so the balances come without their features. Writing a
		// definition from the feature *id* here would overwrite "Messages" with "autumn.messages".
		expect(customers.ops.some((op) => op._tag === "metric_definition")).toBe(false)
		expect(customers.ops.filter((op) => op._tag === "metric").map((op) => op.metricKey)).toContain(
			"autumn.messages",
		)
		// The feature phase, which does name them, runs first in every walk.
		const features = await run(page(fake, null))
		expect(features.ops).toMatchObject([
			{ _tag: "metric_definition", key: "autumn.messages", name: "Messages" },
			{ _tag: "metric_definition", key: "autumn.seats", name: "Seats" },
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
