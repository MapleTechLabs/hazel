/**
 * A fake Autumn API for the adapter's tests: it serves the recorded fixtures from the real
 * endpoints with Autumn's own opaque cursor paging, its `statuses`, `customer_id`, `plan_id` and
 * `created_at_range` filtering and its `expand` handling (a balance's `feature` and a plan's `plan` are absent until a
 * request asks for them, exactly as Autumn sends them), answers 404 for a customer it does not hold, refuses the wrong key with
 * Autumn's error body, and can be told to answer 429, fail a path (503), refuse it (400), garble
 * its body or drop a customer it cannot serialize from its page. It records every call, so a test can assert how many requests a page cost, that the
 * version is pinned, and that the key only ever travels in the `Authorization` header.
 */
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { AUTUMN_API_URL } from "./http"

type Row = Record<string, unknown>

export interface FakeAutumnState {
	readonly apiKey: string
	/** `GET /v1/organization/me`; null: the route answers 403. */
	readonly me: unknown | null
	readonly organization: unknown | null
	readonly features: ReadonlyArray<Row>
	readonly plans: ReadonlyArray<Row>
	readonly customers: ReadonlyArray<Row>
	/** `subscriptions.list` rows, across every customer, oldest first. */
	readonly subscriptions: ReadonlyArray<Row>
	/** Paths answered 403, the way a key without the scope is. */
	readonly forbidden: ReadonlyArray<string>
	/** Paths answered 503: Autumn having a bad moment. */
	readonly failing: ReadonlyArray<string>
	/** Paths answered 400: a request Autumn will refuse however often it is sent. */
	readonly invalid: ReadonlyArray<string>
	/** Paths answered 200 with a body that is not the object (Autumn changed its API). */
	readonly garbled: ReadonlyArray<string>
	/**
	 * Customer ids `customers.list` fails to serialize: dropped from their page after it is cut and
	 * its cursor taken, as `CusBatchService.getCursorPage` logs and skips them.
	 */
	readonly unserializable: ReadonlyArray<string>
	/** Calls served before every further call answers 429. */
	throttleAfter: number | null
	/** Seconds in the `Retry-After` header of those 429s. */
	retryAfterSeconds: number | null
	/** 429s answered so far; a test asserts the retry happened. */
	throttled: number
	readonly calls: Array<{ readonly path: string; readonly body: Row }>
	readonly authHeaders: Array<string>
	readonly versions: Array<string>
}

export const makeFakeAutumn = (options: Partial<FakeAutumnState> = {}): FakeAutumnState => ({
	apiKey: "am_sk_live_fake0000000000000000",
	me: null,
	organization: null,
	features: [],
	plans: [],
	customers: [],
	subscriptions: [],
	forbidden: [],
	failing: [],
	invalid: [],
	garbled: [],
	unserializable: [],
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

const autumnError = (status: number, message: string, code: string) =>
	json(status, { message, code, env: "live" })

const str = (body: Row, key: string): string | undefined => {
	const value = body[key]
	return typeof value === "string" && value !== "" ? value : undefined
}

const strings = (body: Row, key: string): Array<string> => {
	const value = body[key]
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

/**
 * `{ list, next_cursor, has_more }` paged the way Autumn does: an opaque cursor over the rows, and
 * none when the page's last row has no id (`CusBatchService.getCursorPage`), more rows or not.
 */
const listOf = (
	rows: ReadonlyArray<Row>,
	body: Row,
	idOf: (row: Row) => string,
	served: (row: Row) => boolean = () => true,
) => {
	const limit = Math.max(1, Number(body["limit"] ?? 50))
	const after = str(body, "start_cursor")
	const start = after === undefined ? 0 : rows.findIndex((row) => idOf(row) === after) + 1
	const page = rows.slice(start, start + limit)
	const hasMore = start + page.length < rows.length
	const last = page.at(-1)
	return json(200, {
		list: page.filter(served),
		has_more: hasMore,
		next_cursor: hasMore && last !== undefined && idOf(last) !== "" ? idOf(last) : null,
	})
}

/**
 * What Autumn returns for a customer: its balances carry `feature`, and its plans `plan` (the
 * customer's own version, else the catalog's active one), only when `expand` asks for them. Both
 * customer reads take `expand` in the body (Autumn's `expandMiddleware`).
 */
const withExpands = (fake: FakeAutumnState, customer: Row, expand: ReadonlyArray<string>): Row => {
	const balances = (customer["balances"] ?? {}) as Record<string, Row>
	const subscriptions = (customer["subscriptions"] ?? []) as ReadonlyArray<Row>
	return {
		...customer,
		balances: expand.includes("balances.feature")
			? balances
			: Object.fromEntries(
					Object.entries(balances).map(([key, balance]) => {
						const { feature: _dropped, ...rest } = balance
						return [key, rest]
					}),
				),
		subscriptions: subscriptions.map((subscription) => {
			const { plan, ...rest } = subscription
			if (!expand.includes("subscriptions.plan")) return rest
			const catalog = fake.plans.find(
				(row) => row["id"] === subscription["plan_id"] && row["active"] !== false,
			)
			return { ...rest, plan: plan ?? catalog }
		}),
	}
}

const serve = (fake: FakeAutumnState, path: string, body: Row): Response => {
	if (fake.forbidden.includes(path) || (path === "/v1/organization/me" && fake.me === null)) {
		return autumnError(403, "This key does not have access to this resource", "insufficient_scopes")
	}
	if (fake.failing.includes(path))
		return autumnError(503, "Autumn is having a bad moment", "internal_error")
	if (fake.invalid.includes(path)) return autumnError(400, "Invalid inputs", "invalid_inputs")
	if (fake.garbled.includes(path)) return json(200, { object: "garbled" })
	switch (path) {
		case "/v1/organization/me":
			return json(200, fake.me)
		case "/v1/organization":
			return fake.organization === null
				? autumnError(404, "Organization not found", "org_not_found")
				: json(200, fake.organization)
		case "/v1/features.list":
			return json(200, { list: fake.features })
		case "/v1/plans.list": {
			const archived = body["include_archived"] === true
			return json(200, {
				list: fake.plans.filter((plan) => archived || plan["active"] !== false),
			})
		}
		case "/v1/customers.get": {
			const id = str(body, "customer_id")
			// Autumn finds a customer by its own id or its internal one (`autumn_id` here).
			const found = fake.customers.find(
				(customer) => customer["id"] === id || customer["autumn_id"] === id,
			)
			return found === undefined
				? autumnError(404, "Customer not found", "customer_not_found")
				: json(200, withExpands(fake, found, strings(body, "expand")))
		}
		case "/v1/customers.list": {
			const descending = str(body, "sort_order") === "desc"
			const ordered = descending ? [...fake.customers].reverse() : fake.customers
			// `created_at_range.start` (inclusive); the fixtures are listed in creation order.
			const start = (body["created_at_range"] as { start?: number } | undefined)?.start
			const rows = ordered
				.filter((customer) => start === undefined || Number(customer["created_at"]) >= start)
				.map((customer) => withExpands(fake, customer, strings(body, "expand")))
			return listOf(
				rows,
				body,
				(row) => (row["id"] == null ? "" : String(row["id"])),
				(row) => !fake.unserializable.includes(String(row["id"])),
			)
		}
		case "/v1/subscriptions.list": {
			const statuses = strings(body, "statuses")
			const customer = str(body, "customer_id")
			const plan = str(body, "plan_id")
			const rows = fake.subscriptions
				.filter((row) => statuses.length === 0 || statuses.includes(statusOf(row)))
				.filter((row) => customer === undefined || row["customer_id"] === customer)
				.filter((row) => plan === undefined || row["plan_id"] === plan)
			return listOf(rows, body, (row) => String(row["id"]))
		}
		default:
			return autumnError(404, `No fake for ${path}`, "not_found")
	}
}

/** Autumn's `statuses` filter matches `past_due` on a row Autumn still reports as active. */
const statusOf = (row: Row): string =>
	row["past_due"] === true && row["status"] === "active" ? "past_due" : String(row["status"])

export const fakeAutumnHttpClient = (fake: FakeAutumnState) =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) =>
			Effect.gen(function* () {
				const path = url.href.startsWith(AUTUMN_API_URL) ? url.pathname : url.pathname
				const auth = request.headers["authorization"] ?? ""
				fake.authHeaders.push(auth)
				fake.versions.push(request.headers["x-api-version"] ?? "")
				const raw =
					request.body._tag === "Uint8Array"
						? new TextDecoder().decode(request.body.body)
						: request.body._tag === "Raw" && typeof request.body.body === "string"
							? request.body.body
							: ""
				// SAFETY: every body this fake is sent is one of the adapter's own request objects,
				// serialized by `bodyJsonUnsafe` a moment ago, so it parses back to a record.
				const body = raw === "" ? {} : (JSON.parse(raw) as Row)
				fake.calls.push({ path, body })
				const throttled = fake.throttleAfter !== null && fake.calls.length > fake.throttleAfter
				if (throttled) fake.throttled += 1
				const response =
					auth !== `Bearer ${fake.apiKey}`
						? autumnError(401, "Invalid secret key", "invalid_key")
						: throttled
							? json(
									429,
									{ message: "Too many requests", code: "rate_limited", env: "live" },
									fake.retryAfterSeconds === null
										? {}
										: { "retry-after": String(fake.retryAfterSeconds) },
								)
							: serve(fake, path, body)
				return HttpClientResponse.fromWeb(request, response)
			}),
		),
	)
