/**
 * A fake Google for the adapter's tests: the token endpoint (a refresh token for an access token,
 * `invalid_grant` for any other) and the three Gmail reads, answered from a list of messages the
 * way Gmail would — `after:` filters by the message's time, `maxResults` pages with a token, an id
 * it does not hold is a 404. It can also fail one message's get (503), answer every read with
 * Gmail's 403 quota refusal, and it records every call.
 */
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import type { Message } from "./wire"

export interface FakeGmailState {
	readonly mailbox: string
	readonly refreshToken: string
	readonly accessToken: string
	readonly messages: Array<Message>
	/** Ids listed but gone by the time they are read (404). */
	readonly deleted: Set<string>
	/** Ids whose read fails with a 503. */
	readonly failing: Set<string>
	/** Every Gmail read answers 403 `rateLimitExceeded`. */
	quota: boolean
	readonly calls: Array<string>
	readonly queries: Array<string>
}

export const makeFakeGmail = (options: Partial<FakeGmailState> = {}): FakeGmailState => ({
	mailbox: "Ada@Hazel.sh",
	refreshToken: "1//refresh-token",
	accessToken: "ya29.access-token",
	messages: [],
	deleted: new Set(),
	failing: new Set(),
	quota: false,
	calls: [],
	queries: [],
	...options,
})

const json = (status: number, body: unknown) => Response.json(body, { status })

const googleError = (status: number, message: string, reason: string) =>
	json(status, { error: { code: status, message, errors: [{ reason }] } })

const answer = (fake: FakeGmailState, url: URL, method: string, body: string, auth: string) => {
	if (url.origin === "https://oauth2.googleapis.com" && method === "POST") {
		const form = new URLSearchParams(body)
		return form.get("grant_type") === "refresh_token" && form.get("refresh_token") === fake.refreshToken
			? json(200, {
					access_token: fake.accessToken,
					expires_in: 3599,
					scope: "x",
					token_type: "Bearer",
				})
			: json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." })
	}
	if (auth !== `Bearer ${fake.accessToken}`) return googleError(401, "Invalid Credentials", "authError")
	if (fake.quota) return googleError(403, "User Rate Limit Exceeded", "userRateLimitExceeded")
	const path = url.pathname
	if (path === "/gmail/v1/users/me/profile")
		return json(200, { emailAddress: fake.mailbox, messagesTotal: 1 })
	if (path === "/gmail/v1/users/me/messages") {
		const q = url.searchParams.get("q") ?? ""
		fake.queries.push(q)
		const after = Number(/after:(\d+)/.exec(q)?.[1] ?? 0)
		const listed = fake.messages
			.filter((message) => Number(message.internalDate) / 1000 > after)
			.sort((a, b) => Number(b.internalDate) - Number(a.internalDate))
		const offset = Number(url.searchParams.get("pageToken") ?? 0)
		const size = Number(url.searchParams.get("maxResults") ?? 100)
		const messages = listed
			.slice(offset, offset + size)
			.map((message) => ({ id: message.id, threadId: message.threadId }))
		const resultSizeEstimate = listed.length
		return json(
			200,
			offset + size < listed.length
				? { messages, nextPageToken: String(offset + size), resultSizeEstimate }
				: { messages, resultSizeEstimate },
		)
	}
	const id = decodeURIComponent(path.split("/").pop() ?? "")
	if (fake.failing.has(id)) return json(503, { error: { code: 503, message: "Backend Error" } })
	const message = fake.messages.find((candidate) => candidate.id === id)
	if (message === undefined || fake.deleted.has(id))
		return googleError(404, "Requested entity was not found.", "notFound")
	return json(200, message)
}

export const fakeGmailHttpClient = (fake: FakeGmailState) =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) =>
			Effect.sync(() => {
				fake.calls.push(`${request.method} ${url.origin}${url.pathname}`)
				const body =
					request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : ""
				const response = answer(
					fake,
					url,
					request.method,
					body,
					request.headers["authorization"] ?? "",
				)
				return HttpClientResponse.fromWeb(request, response)
			}),
		),
	)

/** The server's Google OAuth client, as the env carries it. */
export const gmailOAuthEnv = ConfigProvider.layer(
	ConfigProvider.fromUnknown({
		GOOGLE_GMAIL_CLIENT_ID: "client-id.apps.googleusercontent.com",
		GOOGLE_GMAIL_CLIENT_SECRET: "client-secret",
	}),
)
