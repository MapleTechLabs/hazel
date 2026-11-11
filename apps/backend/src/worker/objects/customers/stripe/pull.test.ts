/**
 * The pull: the full walk's three phases, the cursor that resumes them and the `sweep` flag on its
 * last page; the scheduled pull's events (never swept), each object read once; and how
 * Stripe's refusals come back (`auth` stops pulls, a short 429 is waited out, a long one is handed
 * to the alarm, a body Hazel cannot read fails the run).
 */
import type { ConnectionConfig, IngestOp, UpsertSubscription } from "@hazel/domain/customers"
import { Effect, Fiber, Layer, Option, Redacted } from "effect"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"
import type { PullPage } from "../providers"
import {
	CUSTOMER_ACME,
	CUSTOMER_GLOBEX,
	CUSTOMER_PERSONAL,
	DISCOUNT_20_PERCENT,
	eventObject,
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
import { WEBHOOK_REQUESTS } from "../provider-http"
import { makeStripeGet } from "./http"
import { decodeCursor, encodeCursor, PAGE_SIZE, pullPage } from "./pull"
import { type FakeStripeState, fakeStripeHttpClient, makeFakeStripe } from "./testing"
import { StripeCustomersPage } from "./wire"

const API_KEY = "rk_test_fake000000000000000000"
const CONFIG: ConnectionConfig = {
	_tag: "stripe",
	clerkOrgMetadataKey: "clerk_org_id",
	matchByDomain: true,
	accountId: "",
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

describe("the Stripe pull's full walk", () => {
	it("walks customers, subscriptions and invoices, and stops", async () => {
		const fake = account()
		const pages = await walk(fake)
		expect(pages.map((entry) => entry.step)).toEqual(["customers", "subscriptions", "invoices"])
		expect(fake.calls.map((call) => call.path)).toEqual([
			"/customers",
			"/subscriptions",
			"/products",
			"/invoices",
		])
	})

	it("asks for canceled subscriptions too, read the way every path reads them", async () => {
		const fake = account()
		await walk(fake)
		const params = fake.calls.find((call) => call.path === "/subscriptions")!.params
		expect(params).toEqual([
			["limit", "100"],
			["status", "all"],
			["expand[]", "data.discounts"],
			["expand[]", "data.default_payment_method"],
			["expand[]", "data.customer.invoice_settings.default_payment_method"],
		])
	})

	it("writes the accounts with their billing contacts, then the subscriptions, then the invoices", async () => {
		const [customers, subscriptions, invoices] = await walk(account())
		// Three customers, two of which have an email to bill.
		expect(tags(customers!.ops)).toEqual(["account", "contact", "account", "account", "contact"])
		expect(tags(subscriptions!.ops)).toEqual(["subscription", "subscription", "subscription"])
		expect(tags(invoices!.ops)).toEqual(["invoice", "invoice"])
	})

	it("names the plans from one product lookup per page, however many products there are", async () => {
		const fake = account()
		const [, subscriptions] = await walk(fake)
		expect(
			subscriptions!.ops
				.filter((op): op is UpsertSubscription => op._tag === "subscription")
				.map((op) => [op.planName, op.mrrMinor]),
		).toEqual([
			["Pro", 120_000],
			["Extra seats", 14_700],
			["Pro", 10_000],
		])
		expect(fake.calls.find((call) => call.path === "/products")!.params).toEqual([
			["limit", "100"],
			["ids[]", PRODUCT_PRO.id],
			["ids[]", PRODUCT_SEATS.id],
		])
	})

	it("carries the card and the discounts Stripe only sends when asked", async () => {
		const [, subscriptions] = await walk(
			account({
				subscriptions: [{ ...SUB_ACME, discounts: [DISCOUNT_20_PERCENT.id] }],
				discounts: [DISCOUNT_20_PERCENT],
			}),
		)
		expect(subscriptions!.ops[0]).toMatchObject({
			mrrMinor: 96_000,
			listMrrMinor: 120_000,
			paymentMethod: { brand: "visa", last4: "4242", expMonth: 4, expYear: 2030 },
		})
	})

	it("stamps its account and contact ops with the time it asked Stripe", async () => {
		const [customers] = await walk(account())
		const observed = customers!.ops.map((op) => (op as { observedAt?: string }).observedAt)
		expect(observed.every((at) => at !== undefined)).toBe(true)
		for (const at of observed) expect(Date.now() - Date.parse(at!)).toBeLessThan(60_000)
	})

	it("asks core to remove what it did not see on its last page", async () => {
		expect((await walk(account())).map((entry) => entry.sweep)).toEqual([
			undefined,
			undefined,
			["account"],
		])
	})

	it("bounds the invoices to the last year", async () => {
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
		// The next page starts the subscriptions phase, with its own counter.
		expect(decodeCursor(second.nextCursor!)).toEqual(
			Option.some({ phase: "subscriptions", after: null, done: 0 }),
		)
	})

	it("resumes a phase from its cursor", async () => {
		const fake = account()
		const result = await run(page(fake, encodeCursor({ phase: "subscriptions", after: SUB_ACME.id })))
		expect(result.ops.map((op) => (op as UpsertSubscription).externalId)).toEqual([
			SUB_GLOBEX.id,
			SUB_PERSONAL_CANCELED.id,
		])
	})

	it("starts over from a cursor it cannot read, rather than failing the run", async () => {
		for (const cursor of [
			"{",
			'{"phase":"charges","after":null}',
			// The products phase of an earlier deploy.
			'{"phase":"products","after":null,"products":{}}',
			'{"phase":"invoices","after":"in_1","done":-1}',
		]) {
			expect(decodeCursor(cursor)).toEqual(Option.none())
		}
		expect(decodeCursor('{"phase":"invoices","after":"in_1"}')).toEqual(
			Option.some({ phase: "invoices", after: "in_1" }),
		)
		expect((await run(page(account(), "{"))).progress.step).toBe("customers")
	})
})

describe("the Stripe pull's events", () => {
	const SINCE = new Date(Date.now() - 6 * 3_600_000)
	const at = (hoursAgo: number) => Math.floor(Date.now() / 1000) - hoursAgo * 3_600
	const stripeEvent = (id: string, type: string, object: unknown, created: number) => ({
		...eventObject(type, object, { created }),
		id,
	})

	/** Newest first, as Stripe lists them: a renewal that failed, a paid invoice, a new customer. */
	const EVENTS = [
		stripeEvent("evt_4", "customer.subscription.updated", SUB_ACME, at(1)),
		stripeEvent("evt_3", "invoice.paid", INVOICE_ACME_PAID, at(2)),
		stripeEvent("evt_2", "customer.subscription.created", SUB_ACME, at(3)),
		stripeEvent("evt_1", "customer.created", CUSTOMER_GLOBEX, at(4)),
	]

	it("reads the events since the last success, and each changed object's current state once", async () => {
		const fake = account({ events: EVENTS })
		const pages = await walk(fake, SINCE)
		expect(pages.map((entry) => [entry.step, entry.sweep])).toEqual([["events", undefined]])
		const [events] = fake.calls
		expect(events!.path).toBe("/events")
		expect(events!.params.find(([key]) => key === "created[gte]")?.[1]).toBe(
			String(Math.floor(SINCE.getTime() / 1000)),
		)
		expect(events!.params.filter(([key]) => key === "types[]").map(([, type]) => type)).toContain(
			"customer.subscription.updated",
		)
		// Two events of one subscription: one read.
		expect(
			fake.calls
				.slice(1)
				.map((call) => call.path)
				.sort(),
		).toEqual([
			`/customers/${CUSTOMER_GLOBEX.id}`,
			`/invoices/${INVOICE_ACME_PAID.id}`,
			"/products",
			`/subscriptions/${SUB_ACME.id}`,
		])
		// Oldest first: the new customer lands before anything that names it.
		expect(tags(pages[0]!.ops)).toEqual(["account", "invoice", "subscription"])
	})

	it("writes what Stripe has now, not what the event carried", async () => {
		const fake = account({
			events: EVENTS,
			subscriptions: [{ ...SUB_ACME, status: "canceled", canceled_at: at(1) }],
		})
		const [events] = await walk(fake, SINCE)
		expect(events!.ops.find((op) => op._tag === "subscription")).toMatchObject({ status: "canceled" })
	})

	it("fails the page, to be retried, when an object cannot be read now", async () => {
		const fake = account({ events: EVENTS, failing: [`/subscriptions/${SUB_ACME.id}`] })
		const error = await run(Effect.flip(page(fake, null, { since: SINCE })))
		expect(error).toMatchObject({ code: "provider", httpStatus: 503 })
		expect(error.retryable).toBeUndefined()
	})

	it("walks everything instead once the last success is older than Stripe keeps events", async () => {
		const pages = await walk(account({ events: EVENTS }), new Date(Date.now() - 40 * 86_400_000))
		expect(pages.map((entry) => entry.step)).toEqual(["customers", "subscriptions", "invoices"])
		expect(pages.at(-1)!.sweep).toEqual(["account"])
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
