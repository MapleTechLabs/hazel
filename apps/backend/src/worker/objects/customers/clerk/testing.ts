/**
 * A fake Clerk Backend API for the adapter's tests: it serves the recorded fixtures from the real
 * endpoints with real pagination, refuses the wrong secret key with Clerk's own error body, and can
 * be told to answer 429 with a `Retry-After`. It records every call, so a test can assert how many
 * requests a page cost and that the key only ever travels in the `Authorization` header.
 */
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse, type UrlParams } from "effect/http"
import { CLERK_API_URL } from "./http"

export interface FakeClerkState {
	readonly secretKey: string
	readonly organizations: ReadonlyArray<unknown>
	readonly memberships: ReadonlyArray<unknown>
	readonly domains: ReadonlyArray<unknown>
	readonly users: ReadonlyArray<{ readonly id: string } & Record<string, unknown>>
	readonly instance: unknown | null
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
}

export const makeFakeClerk = (options: Partial<FakeClerkState> = {}): FakeClerkState => ({
	secretKey: "sk_test_fake000000000000000000",
	organizations: [],
	memberships: [],
	domains: [],
	users: [],
	instance: null,
	throttleAfter: null,
	retryAfterSeconds: null,
	throttled: 0,
	calls: [],
	authHeaders: [],
	...options,
})

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
	Response.json(body, { status, headers })

const clerkError = (status: number, message: string) =>
	json(status, { errors: [{ message, long_message: message, code: "fake" }] })

const first = (params: UrlParams.UrlParams, key: string): string | undefined => {
	for (const [name, value] of params.params) if (name === key) return String(value)
	return undefined
}

const all = (params: UrlParams.UrlParams, key: string): Array<string> => {
	const values: Array<string> = []
	for (const [name, value] of params.params) if (name === key) values.push(String(value))
	return values
}

/** `{ data, total_count }`, sliced the way Clerk's `limit`/`offset` do. */
const pageOf = (rows: ReadonlyArray<unknown>, params: UrlParams.UrlParams) => {
	const limit = Number(first(params, "limit") ?? 10)
	const offset = Number(first(params, "offset") ?? 0)
	return json(200, { data: rows.slice(offset, offset + limit), total_count: rows.length })
}

const serve = (fake: FakeClerkState, path: string, params: UrlParams.UrlParams): Response => {
	const memberships = /^\/users\/([^/]+)\/organization_memberships$/.exec(path)
	if (memberships !== null) {
		const userId = memberships[1]
		const user = fake.users.find((candidate) => candidate.id === userId)
		if (user === undefined) return clerkError(404, "User not found")
		return pageOf(
			fake.memberships.filter(
				(membership) =>
					(membership as { public_user_data?: { user_id?: string } }).public_user_data?.user_id ===
					userId,
			),
			params,
		)
	}
	switch (path) {
		case "/instance":
			return fake.instance === null
				? clerkError(403, "Not enabled for this instance")
				: json(200, fake.instance)
		case "/organizations":
			return pageOf(fake.organizations, params)
		case "/organization_memberships":
			return pageOf(fake.memberships, params)
		case "/organization_domains":
			return pageOf(fake.domains, params)
		case "/users": {
			// Clerk's list endpoint answers a bare array, and `user_id` repeats for a batch.
			const wanted = all(params, "user_id")
			const rows =
				wanted.length === 0 ? fake.users : fake.users.filter((user) => wanted.includes(user.id))
			return json(200, rows)
		}
		default:
			return clerkError(404, `No fake for ${path}`)
	}
}

export const fakeClerkHttpClient = (fake: FakeClerkState) =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) =>
			Effect.sync(() => {
				const path = url.href.startsWith(CLERK_API_URL)
					? url.pathname.replace(/^\/v1/, "")
					: url.pathname
				const auth = request.headers["authorization"] ?? ""
				fake.authHeaders.push(auth)
				fake.calls.push({
					path,
					params: request.urlParams.params.map(([key, value]) => [key, String(value)] as const),
				})
				const throttled = fake.throttleAfter !== null && fake.calls.length > fake.throttleAfter
				if (throttled) fake.throttled += 1
				const response =
					auth !== `Bearer ${fake.secretKey}`
						? clerkError(401, "The provided Clerk Secret Key is invalid.")
						: throttled
							? json(
									429,
									{ errors: [{ message: "Too many requests" }] },
									fake.retryAfterSeconds === null
										? {}
										: { "retry-after": String(fake.retryAfterSeconds) },
								)
							: serve(fake, path, request.urlParams)
				return HttpClientResponse.fromWeb(request, response)
			}),
		),
	)
