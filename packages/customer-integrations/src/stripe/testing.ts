/**
 * A fake Stripe API for the adapter's tests: it serves the recorded fixtures from the real
 * endpoints with Stripe's own `starting_after` paging, `created[gte]`, `ids[]` and `types[]`
 * filtering and `expand[]` handling (a subscription's payment method, discounts and customer are
 * ids until a request asks for them, exactly as Stripe sends them), answers 404 for an object it
 * does not hold, refuses the wrong key with Stripe's error body, and can be told to answer 429,
 * fail a path (503), refuse it (400) or garble its body. It records every call, so a test can assert how many requests a page cost and that
 * the key only ever travels in the `Authorization` header.
 */
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse, type UrlParams } from "effect/http"
import { STRIPE_API_URL } from "./http"

type Row = { readonly id: string } & Record<string, unknown>

export interface FakeStripeState {
	readonly apiKey: string
	readonly customers: ReadonlyArray<Row>
	readonly products: ReadonlyArray<Row>
	readonly subscriptions: ReadonlyArray<Row>
	readonly invoices: ReadonlyArray<Row>
	/** Expanded into a subscription's `default_payment_method` when a request asks for it. */
	readonly paymentMethods: ReadonlyArray<Row>
	/** Expanded into a subscription's `discounts` when a request asks for it. */
	readonly discounts: ReadonlyArray<Row>
	/** `/v1/events`, newest first as Stripe lists them. */
	readonly events: ReadonlyArray<Row>
	/** Null: `/account` answers 403, as it does for a restricted key. */
	readonly account: unknown | null
	/** The account a 403 names, as Stripe's permission errors do. */
	readonly refusedOnAccount: string | null
	/** Paths a restricted key may not read: answered 403, the way a missing permission is. */
	readonly forbidden: ReadonlyArray<string>
	/** Paths answered 503: Stripe having a bad moment. */
	readonly failing: ReadonlyArray<string>
	/** Paths answered 400: a request Stripe will refuse however often it is sent. */
	readonly invalid: ReadonlyArray<string>
	/** Paths answered 200 with a body that is not the object (Stripe changed its API). */
	readonly garbled: ReadonlyArray<string>
	/** Calls served before every further call answers 429. */
	throttleAfter: number | null
	/** Seconds in the `Retry-After` header of those 429s. */
	retryAfterSeconds: number | null
	/** 429s answered so far; a test asserts the retry happened. */
	throttled: number
	readonly calls: Array<{
		readonly path: string
		readonly params: ReadonlyArray<readonly [string, string]>
	}>
	readonly authHeaders: Array<string>
	readonly versions: Array<string>
}

export const makeFakeStripe = (options: Partial<FakeStripeState> = {}): FakeStripeState => ({
	apiKey: "rk_test_fake000000000000000000",
	customers: [],
	products: [],
	subscriptions: [],
	invoices: [],
	paymentMethods: [],
	discounts: [],
	events: [],
	account: null,
	refusedOnAccount: null,
	forbidden: [],
	failing: [],
	invalid: [],
	garbled: [],
	throttleAfter: null,
	retryAfterSeconds: null,
	throttled: 0,
	calls: [],
	authHeaders: [],
	versions: [],
	...options,
})

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
	Response.json(body, { status, headers })

const stripeError = (status: number, message: string, code: string) =>
	json(status, { error: { type: "invalid_request_error", code, message } })

const first = (params: UrlParams.UrlParams, key: string): string | undefined => {
	for (const [name, value] of params.params) if (name === key) return String(value)
	return undefined
}

const all = (params: UrlParams.UrlParams, key: string): Array<string> => {
	const values: Array<string> = []
	for (const [name, value] of params.params) if (name === key) values.push(String(value))
	return values
}

/** `{ object: "list", data, has_more }`, filtered and sliced the way Stripe does. */
const listOf = (rows: ReadonlyArray<Row>, params: UrlParams.UrlParams) => {
	const limit = Number(first(params, "limit") ?? 10)
	const after = first(params, "starting_after")
	const createdGte = first(params, "created[gte]")
	const ids = all(params, "ids[]")
	const types = all(params, "types[]")
	const filtered = rows
		.filter((row) => createdGte === undefined || Number(row["created"] ?? 0) >= Number(createdGte))
		.filter((row) => ids.length === 0 || ids.includes(row.id))
		.filter((row) => types.length === 0 || types.includes(String(row["type"])))
	const start = after === undefined ? 0 : filtered.findIndex((row) => row.id === after) + 1
	const page = filtered.slice(start, start + limit)
	return json(200, {
		object: "list",
		url: "/v1/fake",
		data: page,
		has_more: start + page.length < filtered.length,
	})
}

const byId = (rows: ReadonlyArray<Row>, id: unknown): Row | undefined =>
	typeof id === "string" ? rows.find((row) => row.id === id) : undefined

/** What Stripe returns for a subscription: ids, unless the request expanded them (`prefix.path`). */
const expandSubscription = (
	fake: FakeStripeState,
	subscription: Row,
	expands: ReadonlyArray<string>,
	prefix: "" | "data.",
): Row => {
	const expanded = (path: string) => expands.includes(`${prefix}${path}`)
	const method = (id: unknown) => byId(fake.paymentMethods, id) ?? id
	const discountIds = subscription["discounts"]
	const customer = byId(fake.customers, subscription["customer"])
	const settings = customer?.["invoice_settings"] as Record<string, unknown> | undefined
	return {
		...subscription,
		default_payment_method: expanded("default_payment_method")
			? method(subscription["default_payment_method"])
			: subscription["default_payment_method"],
		discounts:
			expanded("discounts") && Array.isArray(discountIds)
				? discountIds.map((id) => byId(fake.discounts, id) ?? id)
				: discountIds,
		customer:
			expanded("customer.invoice_settings.default_payment_method") && customer !== undefined
				? {
						...customer,
						invoice_settings: {
							...settings,
							default_payment_method: method(settings?.["default_payment_method"] ?? null),
						},
					}
				: subscription["customer"],
	} as Row
}

const missing = (id: string) => stripeError(404, `No such object: '${id}'`, "resource_missing")

const serve = (fake: FakeStripeState, path: string, params: UrlParams.UrlParams): Response => {
	if (fake.forbidden.includes(path) || (path === "/account" && fake.account === null)) {
		const on = fake.refusedOnAccount === null ? "" : ` on account '${fake.refusedOnAccount}'`
		return stripeError(
			403,
			`The provided key 'rk_test_*****0000' does not have the required permissions for this endpoint${on}.`,
			"permission",
		)
	}
	if (fake.failing.includes(path)) return stripeError(503, "Stripe is having a bad moment", "api_error")
	if (fake.invalid.includes(path)) return stripeError(400, "Invalid request", "parameter_invalid")
	if (fake.garbled.includes(path)) return json(200, { object: "garbled" })
	const one = /^\/(customers|subscriptions|invoices)\/([^/]+)$/.exec(path)
	if (one !== null) {
		const kind = one[1] as "customers" | "subscriptions" | "invoices"
		const id = one[2] ?? ""
		const found = byId(fake[kind], id)
		if (found === undefined) return missing(id)
		return json(
			200,
			kind === "subscriptions" ? expandSubscription(fake, found, all(params, "expand[]"), "") : found,
		)
	}
	switch (path) {
		case "/account":
			return json(200, fake.account)
		case "/events":
			return listOf(fake.events, params)
		case "/customers":
			return listOf(fake.customers, params)
		case "/products":
			return listOf(fake.products, params)
		case "/subscriptions": {
			const status = first(params, "status")
			const customer = first(params, "customer")
			const expands = all(params, "expand[]")
			const rows = fake.subscriptions
				.filter((row) => status === "all" || row["status"] !== "canceled")
				.filter((row) => customer === undefined || row["customer"] === customer)
				.map((row) => expandSubscription(fake, row, expands, "data."))
			return listOf(rows, params)
		}
		case "/invoices": {
			const status = first(params, "status")
			return listOf(
				fake.invoices.filter((row) => status === undefined || row["status"] === status),
				params,
			)
		}
		default:
			return stripeError(404, `No fake for ${path}`, "resource_missing")
	}
}

export const fakeStripeHttpClient = (fake: FakeStripeState) =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) =>
			Effect.sync(() => {
				const path = url.href.startsWith(STRIPE_API_URL)
					? url.pathname.replace(/^\/v1/, "")
					: url.pathname
				const auth = request.headers["authorization"] ?? ""
				fake.authHeaders.push(auth)
				fake.versions.push(request.headers["stripe-version"] ?? "")
				fake.calls.push({
					path,
					params: request.urlParams.params.map(([key, value]) => [key, String(value)] as const),
				})
				const throttled = fake.throttleAfter !== null && fake.calls.length > fake.throttleAfter
				if (throttled) fake.throttled += 1
				const response =
					auth !== `Bearer ${fake.apiKey}`
						? stripeError(401, "Invalid API Key provided: rk_test_***", "api_key_invalid")
						: throttled
							? json(
									429,
									{ error: { type: "rate_limit_error", message: "Too many requests" } },
									fake.retryAfterSeconds === null
										? {}
										: { "retry-after": String(fake.retryAfterSeconds) },
								)
							: serve(fake, path, request.urlParams)
				return HttpClientResponse.fromWeb(request, response)
			}),
		),
	)
