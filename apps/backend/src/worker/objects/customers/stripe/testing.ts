/**
 * A fake Stripe API for the adapter's tests: it serves the recorded fixtures from the real
 * endpoints with Stripe's own `starting_after` paging, `created[gte]` filtering and `expand[]`
 * handling (a subscription's payment method and discounts are ids until a request asks for them,
 * exactly as Stripe sends them), refuses the wrong key with Stripe's error body, and can be told to
 * answer 429. It records every call, so a test can assert how many requests a page cost and that
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
	readonly account: unknown | null
	/** Paths a restricted key may not read: answered 403, the way a missing permission is. */
	readonly forbidden: ReadonlyArray<string>
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
	account: null,
	forbidden: [],
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

/** `{ object: "list", data, has_more }`, sliced the way Stripe's `starting_after` does. */
const listOf = (rows: ReadonlyArray<Row>, params: UrlParams.UrlParams) => {
	const limit = Number(first(params, "limit") ?? 10)
	const after = first(params, "starting_after")
	const createdGte = first(params, "created[gte]")
	const filtered =
		createdGte === undefined
			? rows
			: rows.filter((row) => Number(row["created"] ?? 0) >= Number(createdGte))
	const start = after === undefined ? 0 : filtered.findIndex((row) => row.id === after) + 1
	const page = filtered.slice(start, start + limit)
	return json(200, {
		object: "list",
		url: "/v1/fake",
		data: page,
		has_more: start + page.length < filtered.length,
	})
}

/** What Stripe returns for a subscription: ids, unless the request expanded them. */
const expandSubscription = (
	fake: FakeStripeState,
	subscription: Row,
	expands: ReadonlyArray<string>,
): Row => {
	const methodId = subscription["default_payment_method"]
	const method =
		expands.includes("data.default_payment_method") && typeof methodId === "string"
			? (fake.paymentMethods.find((row) => row.id === methodId) ?? methodId)
			: methodId
	const discountIds = subscription["discounts"]
	const discounts =
		expands.includes("data.discounts") && Array.isArray(discountIds)
			? discountIds.map((id) =>
					typeof id === "string" ? (fake.discounts.find((row) => row.id === id) ?? id) : id,
				)
			: discountIds
	return { ...subscription, default_payment_method: method, discounts } as Row
}

const serve = (fake: FakeStripeState, path: string, params: UrlParams.UrlParams): Response => {
	if (fake.forbidden.includes(path)) {
		return stripeError(
			403,
			`The provided key does not have the required permissions to access the resource at ${path}.`,
			"permission",
		)
	}
	const product = /^\/products\/([^/]+)$/.exec(path)
	if (product !== null) {
		const found = fake.products.find((row) => row.id === product[1])
		return found === undefined
			? stripeError(404, `No such product: '${product[1]}'`, "resource_missing")
			: json(200, found)
	}
	switch (path) {
		case "/account":
			return fake.account === null
				? stripeError(403, "The provided key does not have the required permissions.", "permission")
				: json(200, fake.account)
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
				.map((row) => expandSubscription(fake, row, expands))
			return listOf(rows, params)
		}
		case "/invoices":
			return listOf(fake.invoices, params)
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
