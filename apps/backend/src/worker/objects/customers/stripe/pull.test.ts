/**
 * The pull: its four phases, the cursor that resumes them, the product names it carries between
 * them, the `sweep` flag on a backfill's last page (and never on an incremental pull), and how
 * Stripe's refusals come back (`auth` stops pulls, a short 429 is waited out, a long one is handed
 * to the alarm, a body Hazel cannot read fails the run).
 */
import type { ConnectionConfig, IngestOp, UpsertSubscription } from "@hazel/domain/customers"
import { Effect, Fiber, Layer, Redacted } from "effect"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"
import type { PullPage } from "../providers"
import {
	CUSTOMER_ACME,
	CUSTOMER_GLOBEX,
	CUSTOMER_PERSONAL,
	INVOICE_ACME_PAID,
	INVOICE_GLOBEX_OPEN,
	PAYMENT_METHOD_ACME,
	PRODUCT_EVENTS,
	PRODUCT_PRO,
	PRODUCT_SEATS,
	SUB_ACME,
	SUB_GLOBEX,
	SUB_PERSONAL_CANCELED,
} from "./fixtures"
import { makeStripeGet, WEBHOOK_REQUESTS } from "./http"
import { decodeCursor, encodeCursor, PAGE_SIZE, pullPage } from "./pull"
import { type FakeStripeState, fakeStripeHttpClient, makeFakeStripe } from "./testing"
import { StripeCustomersPage } from "./wire"

const API_KEY = "rk_test_fake000000000000000000"
const CONFIG: ConnectionConfig = {
	_tag: "stripe",
	clerkOrgMetadataKey: "clerk_org_id",
	matchByDomain: true,
}

/** Invoices dated relative to now, so the backfill's one-year window always holds them. */
const RECENT = Math.floor(Date.now() / 1000) - 86_400

const account = (options: Partial<FakeStripeState> = {}) =>
	makeFakeStripe({
		apiKey: API_KEY,
		customers: [CUSTOMER_ACME, CUSTOMER_GLOBEX, CUSTOMER_PERSONAL],
		products: [PRODUCT_PRO, PRODUCT_SEATS, PRODUCT_EVENTS],
		subscriptions: [SUB_ACME, SUB_GLOBEX, SUB_PERSONAL_CANCELED],
		invoices: [
			{ ...INVOICE_ACME_PAID, created: RECENT },
			{ ...INVOICE_GLOBEX_OPEN, created: RECENT },
		],
		paymentMethods: [PAYMENT_METHOD_ACME],
		...options,
	})

const pageOver = (
	client: Layer.Layer<HttpClient.HttpClient>,
	cursor: string | null,
	options: { readonly since?: Date | null; readonly apiKey?: string } = {},
) =>
	Effect.gen(function* () {
		const get = makeStripeGet(yield* HttpClient.HttpClient, Redacted.make(options.apiKey ?? API_KEY))
		return yield* pullPage({ get, cursor, since: options.since ?? null, config: CONFIG })
	}).pipe(Effect.provide(client))

const page = (
	fake: FakeStripeState,
	cursor: string | null,
	options: { readonly since?: Date | null; readonly apiKey?: string } = {},
) => pageOver(fakeStripeHttpClient(fake), cursor, options)

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

/** A Stripe that answers every request with `respond()`. */
const answering = (respond: () => Response) =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request) => Effect.sync(() => HttpClientResponse.fromWeb(request, respond()))),
	)

const tags = (ops: ReadonlyArray<IngestOp>) => ops.map((op) => op._tag)

/** Walk the whole pull, as the alarm does: each page's `nextCursor` drives the next call. */
const walk = async (fake: FakeStripeState, since: Date | null = null) => {
	const pages: Array<{
		cursor: string | null
		ops: ReadonlyArray<IngestOp>
		step: string
		sweep: PullPage["sweep"]
	}> = []
	let cursor: string | null = null
	for (let guard = 0; guard < 20; guard++) {
		const result: PullPage = await run(page(fake, cursor, { since }))
		pages.push({ cursor, ops: result.ops, step: result.progress.step, sweep: result.sweep })
		if (result.nextCursor === null) return pages
		cursor = result.nextCursor
	}
	throw new Error("the pull did not finish")
}

describe("the Stripe pull", () => {
	it("walks customers, products, subscriptions and invoices, and stops", async () => {
		const fake = account()
		const pages = await walk(fake)
		expect(pages.map((entry) => entry.step)).toEqual([
			"customers",
			"products",
			"subscriptions",
			"invoices",
		])
		expect(fake.calls.map((call) => call.path)).toEqual([
			"/customers",
			"/products",
			"/subscriptions",
			"/invoices",
		])
	})

	it("asks for canceled subscriptions too, with their discounts and card expanded", async () => {
		const fake = account()
		await walk(fake)
		const params = fake.calls.find((call) => call.path === "/subscriptions")!.params
		expect(params).toEqual([
			["limit", "100"],
			["status", "all"],
			["expand[]", "data.default_payment_method"],
			["expand[]", "data.discounts"],
		])
	})

	it("writes the accounts with their billing contacts, then the subscriptions, then the invoices", async () => {
		const [customers, products, subscriptions, invoices] = await walk(account())
		// Three customers, two of which have an email to bill.
		expect(tags(customers!.ops)).toEqual(["account", "contact", "account", "account", "contact"])
		// The products phase only gathers names.
		expect(products!.ops).toEqual([])
		expect(tags(subscriptions!.ops)).toEqual(["subscription", "subscription", "subscription"])
		expect(tags(invoices!.ops)).toEqual(["invoice", "invoice"])
	})

	it("names the plans from the products it listed one phase earlier", async () => {
		const [, , subscriptions] = await walk(account())
		expect(
			subscriptions!.ops
				.filter((op): op is UpsertSubscription => op._tag === "subscription")
				.map((op) => [op.planName, op.mrrMinor]),
		).toEqual([
			["Pro", 120_000],
			["Extra seats", 14_700],
			["Pro", 10_000],
		])
	})

	it("carries the card Stripe only sends when asked", async () => {
		const [, , subscriptions] = await walk(account())
		const acme = subscriptions!.ops.find(
			(op): op is UpsertSubscription => op._tag === "subscription" && op.externalId === SUB_ACME.id,
		)
		expect(acme?.paymentMethod).toEqual({
			brand: "visa",
			last4: "4242",
			expMonth: 4,
			expYear: 2030,
		})
	})

	it("stamps its account and contact ops with the time it asked Stripe", async () => {
		const [customers] = await walk(account())
		const observed = customers!.ops.map((op) => (op as { observedAt?: string }).observedAt)
		expect(observed.every((at) => at !== undefined)).toBe(true)
		for (const at of observed) expect(Date.now() - Date.parse(at!)).toBeLessThan(60_000)
	})

	it("asks core to remove what it did not see only on the last page of a backfill", async () => {
		expect((await walk(account())).map((entry) => entry.sweep)).toEqual([
			undefined,
			undefined,
			undefined,
			["account"],
		])
	})

	it("never sweeps an incremental pull, and asks Stripe only for what is new", async () => {
		const since = new Date(Date.now() - 3 * 86_400_000)
		const fake = account()
		const pages = await walk(fake, since)
		expect(pages.map((entry) => entry.sweep)).toEqual([undefined, undefined, undefined, undefined])
		const gte = String(Math.floor(since.getTime() / 1000))
		expect(fake.calls.map((call) => call.params.find(([key]) => key === "created[gte]")?.[1])).toEqual([
			gte,
			// Products are never narrowed: a new subscription can name an old product.
			undefined,
			gte,
			gte,
		])
		// The customers created before `since` are not listed, so nothing of theirs is written.
		expect(pages[0]!.ops).toEqual([])
	})

	it("bounds a backfill's invoices to the last year", async () => {
		const fake = account()
		await walk(fake)
		const gte = Number(
			fake.calls
				.find((call) => call.path === "/invoices")!
				.params.find(([key]) => key === "created[gte]")![1],
		)
		const days = (Date.now() / 1000 - gte) / 86_400
		expect(days).toBeGreaterThan(364)
		expect(days).toBeLessThan(366)
	})

	it("pages a phase with Stripe's own cursor until it runs out", async () => {
		const many = Array.from({ length: PAGE_SIZE + 20 }, (_, index) => ({
			...CUSTOMER_GLOBEX,
			id: `cus_${String(index).padStart(16, "0")}`,
		}))
		const fake = account({ customers: many })
		const first = await run(page(fake, null))
		expect(first.ops).toHaveLength(PAGE_SIZE)
		expect(first.sweep).toBeUndefined()
		expect(first.progress).toEqual({ step: "customers", done: PAGE_SIZE, total: null })
		const second = await run(page(fake, first.nextCursor))
		expect(second.ops).toHaveLength(20)
		expect(second.progress).toEqual({ step: "customers", done: PAGE_SIZE + 20, total: null })
		expect(fake.calls.map((call) => call.params.find(([key]) => key === "starting_after")?.[1])).toEqual([
			undefined,
			many[PAGE_SIZE - 1]!.id,
		])
		// The next page starts the products phase, with its own counter.
		expect(decodeCursor(second.nextCursor)).toEqual({
			phase: "products",
			after: null,
			done: 0,
			products: {},
		})
	})

	it("resumes a phase from its cursor, product names included", async () => {
		const cursor = encodeCursor({
			phase: "subscriptions",
			after: null,
			done: 0,
			products: { [PRODUCT_PRO.id]: "Pro renamed" },
		})
		const result = await run(page(account(), cursor))
		expect(
			result.ops
				.filter((op): op is UpsertSubscription => op._tag === "subscription")
				.map((op) => op.planName),
		).toEqual(["Pro renamed", null, "Pro renamed"])
	})

	it("restarts the pull from a cursor it cannot read, rather than failing the run", () => {
		expect(decodeCursor(null)).toEqual({ phase: "customers", after: null })
		expect(decodeCursor("{")).toEqual({ phase: "customers", after: null })
		expect(decodeCursor('{"phase":"charges","after":null}')).toEqual({
			phase: "customers",
			after: null,
		})
		expect(decodeCursor('{"phase":"invoices","after":"in_1","done":-1}')).toEqual({
			phase: "customers",
			after: null,
		})
		expect(decodeCursor('{"phase":"invoices","after":"in_1"}')).toEqual({
			phase: "invoices",
			after: "in_1",
		})
	})
})

describe("when Stripe refuses", () => {
	it("reports a rejected key as `auth`, which stops scheduled pulls", async () => {
		const error = await run(Effect.flip(page(account(), null, { apiKey: "rk_test_wrong" })))
		expect(error.code).toBe("auth")
		expect(error.httpStatus).toBe(401)
		// Stripe's own explanation reaches the UI; the key never does.
		expect(error.message).toMatch(/Stripe rejected the API key \(401\): Invalid API Key provided/)
		expect(error.message).not.toContain("rk_test_wrong")
		// Not even the masked key Stripe quotes back.
		expect(error.message).not.toContain("rk_test_")
	})

	it("reports a restricted key missing a permission as `auth`, naming the route", async () => {
		const error = await run(
			Effect.flip(
				pageOver(
					answering(() =>
						Response.json(
							{ error: { message: "This key does not have the required permissions." } },
							{ status: 403 },
						),
					),
					null,
				),
			),
		)
		expect(error).toMatchObject({ code: "auth", httpStatus: 403 })
		expect(error.message).toMatch(/GET \/customers for this key \(403\)/)
		expect(error.message).toMatch(/required permissions/)
	})

	it("waits out a short Retry-After and finishes the page", async () => {
		const fake = account({ throttleAfter: 0, retryAfterSeconds: 1 })
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
		expect(result.ops).toHaveLength(5)
	})

	it("hands a long Retry-After to the alarm as `rate_limited`, without waiting", async () => {
		const fake = account({ throttleAfter: 0, retryAfterSeconds: 120 })
		const error = await run(Effect.flip(page(fake, null)))
		expect(error.code).toBe("rate_limited")
		expect(error.retryAfterMs).toBe(120_000)
		expect(fake.throttled).toBe(1)
	})

	it("gives up after its own retries when Stripe keeps throttling", async () => {
		const fake = account({ throttleAfter: 0, retryAfterSeconds: 1 })
		const error = await run(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(Effect.flip(page(fake, null)))
				yield* TestClock.adjust(10_000)
				return yield* Fiber.join(fiber)
			}).pipe(Effect.provide(TestClock.layer())),
		)
		expect(error.code).toBe("rate_limited")
		expect(fake.throttled).toBe(3)
	})

	it("fails the run on any other refusal, without Stripe's text: a retry would be refused again", async () => {
		const error = await run(
			Effect.flip(
				pageOver(
					answering(() =>
						Response.json(
							{ error: { message: "No such customer: 'cus_gone'", code: "resource_missing" } },
							{ status: 400 },
						),
					),
					encodeCursor({ phase: "customers", after: "cus_gone" }),
				),
			),
		)
		expect(error).toMatchObject({
			code: "provider",
			httpStatus: 400,
			retryable: false,
			message: "Stripe refused GET /customers (400)",
		})
	})

	it("gives up on a request Stripe does not answer within 30 s, as a retryable `network` failure", async () => {
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
			message: "Stripe did not answer GET /customers within 30 s",
		})
		expect(error.retryable).toBeUndefined()
	})

	it("on the webhook path, never waits out a 429 and gives up after 5 s", async () => {
		const fake = account({ throttleAfter: 0, retryAfterSeconds: 1 })
		const throttled = await run(
			Effect.gen(function* () {
				const get = makeStripeGet(
					yield* HttpClient.HttpClient,
					Redacted.make(API_KEY),
					WEBHOOK_REQUESTS,
				)
				return yield* Effect.flip(get("/customers", [], StripeCustomersPage))
			}).pipe(Effect.provide(fakeStripeHttpClient(fake))),
		)
		expect(throttled).toMatchObject({ code: "rate_limited", retryAfterMs: 1_000 })
		expect(fake.throttled).toBe(1)

		const slow = await run(
			Effect.gen(function* () {
				const get = makeStripeGet(
					yield* HttpClient.HttpClient,
					Redacted.make(API_KEY),
					WEBHOOK_REQUESTS,
				)
				const fiber = yield* Effect.forkChild(Effect.flip(get("/customers", [], StripeCustomersPage)))
				yield* TestClock.adjust(5_000)
				return yield* Fiber.join(fiber)
			}).pipe(
				Effect.provide(
					Layer.mergeAll(
						TestClock.layer(),
						Layer.succeed(
							HttpClient.HttpClient,
							HttpClient.make(() => Effect.never),
						),
					),
				),
			),
		)
		expect(slow).toMatchObject({
			code: "network",
			message: "Stripe did not answer GET /customers within 5 s",
		})
	})

	it("maps a 5xx to a retryable `provider` failure", async () => {
		const error = await run(
			Effect.flip(
				pageOver(
					answering(() => Response.json({}, { status: 503 })),
					null,
				),
			),
		)
		expect(error).toMatchObject({ code: "provider", httpStatus: 503 })
		expect(error.retryable).toBeUndefined()
	})

	it("maps an unreachable Stripe to a retryable `network` failure", async () => {
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
			message: "Could not reach Stripe (TransportError)",
		})
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
		expect(renamedField.message).toMatch(/GET \/customers with a body Hazel cannot read/)
		// The body's values never reach the message.
		expect(renamedField.message).not.toContain("No id")
	})

	it("sends the key only in the Authorization header, and pins the API version", async () => {
		const fake = account()
		await walk(fake)
		expect(new Set(fake.authHeaders)).toEqual(new Set([`Bearer ${API_KEY}`]))
		expect(new Set(fake.versions)).toEqual(new Set(["2025-08-27.basil"]))
		expect(JSON.stringify(fake.calls)).not.toContain(API_KEY)
	})
})
