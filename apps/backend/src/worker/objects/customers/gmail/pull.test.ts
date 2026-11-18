/**
 * The Gmail adapter against a fake Google: the token refresh (once per adapter, not per page), the
 * window a backfill and a scheduled pull ask for, the page token that resumes the walk, a message
 * deleted mid-walk, and how Google's refusals come back (a revoked grant stops pulls, a quota 403
 * and a 5xx are retried, a server without the OAuth client is not the connection's fault).
 */
import { DEFAULT_CONNECTION_CONFIG, type RecordEmail } from "@hazel/domain/customers"
import { Effect, Layer, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"
import type { CustomerProviderAdapter, ProviderCredentials, PullPage } from "../providers"
import { makeGmailAdapter } from "./adapter"
import { message, multipart } from "./fixtures"
import { PAGE_SIZE } from "./pull"
import { fakeGmailHttpClient, type FakeGmailState, gmailOAuthEnv, makeFakeGmail } from "./testing"

const NOW = new Date("2026-06-15T12:00:00.000Z")
const DAY = 86_400_000

const credentials = (fake: FakeGmailState, refreshToken = fake.refreshToken): ProviderCredentials => ({
	apiKey: Redacted.make(refreshToken),
	webhookSecret: null,
	config: { ...DEFAULT_CONNECTION_CONFIG.gmail, lookbackDays: 30 },
	externalAccountId: fake.mailbox.toLowerCase(),
})

/** `count` messages from a customer, one an hour back from `NOW`. */
const inbound = (count: number, offsetMs = 0) =>
	Array.from({ length: count }, (_, index) =>
		message({
			id: `m${index}`,
			from: "grace@globex.io",
			to: "ada@hazel.sh",
			at: new Date(NOW.getTime() - offsetMs - (index + 1) * 3_600_000).toISOString(),
		}),
	)

/** The adapter over the fake, on a test clock at `NOW`. */
const withAdapter = <A, E>(
	fake: FakeGmailState,
	body: (adapter: CustomerProviderAdapter) => Effect.Effect<A, E>,
	env: Layer.Layer<never> = gmailOAuthEnv,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW.getTime())
			return yield* body(yield* makeGmailAdapter)
		}).pipe(Effect.provide(Layer.mergeAll(fakeGmailHttpClient(fake), TestClock.layer(), env))),
	)

const walk = (adapter: CustomerProviderAdapter, input: ProviderCredentials, since: Date | null = null) =>
	Effect.gen(function* () {
		const pages: Array<PullPage> = []
		let cursor: string | null = null
		do {
			const page: PullPage = yield* adapter.pull({ credentials: input, cursor, since })
			pages.push(page)
			cursor = page.nextCursor
		} while (cursor !== null)
		return pages
	})

describe("Gmail pull", () => {
	it("backfills the lookback window page by page, refreshing the token once", async () => {
		const fake = makeFakeGmail({ messages: [...inbound(60), ...inbound(3, 40 * DAY)] })
		const pages = await withAdapter(fake, (adapter) => walk(adapter, credentials(fake)))

		expect(pages.map((page) => page.ops.length)).toEqual([PAGE_SIZE, PAGE_SIZE, 10])
		expect(pages.at(-1)?.progress).toEqual({ step: "messages", done: 60, total: null })
		// Every page asks the same search: the window is fixed when the walk starts.
		const after = Math.floor((NOW.getTime() - 30 * DAY) / 1000)
		expect(new Set(fake.queries)).toEqual(new Set([`after:${after} -in:spam -in:trash -in:chats`]))
		expect(fake.calls.filter((call) => call.startsWith("POST"))).toHaveLength(1)
		const first = pages[0]?.ops[0] as RecordEmail
		expect(first).toMatchObject({ _tag: "email", mailbox: "ada@hazel.sh", direction: "inbound" })
	})

	it("reads from `since` on a scheduled pull", async () => {
		const fake = makeFakeGmail({ messages: inbound(10) })
		const since = new Date(NOW.getTime() - 3.5 * 3_600_000)
		const pages = await withAdapter(fake, (adapter) => walk(adapter, credentials(fake), since))

		expect(pages.flatMap((page) => page.ops)).toHaveLength(3)
		expect(fake.queries[0]).toBe(
			`after:${Math.floor(since.getTime() / 1000)} -in:spam -in:trash -in:chats`,
		)
	})

	it("skips a message deleted between the list and its read", async () => {
		const fake = makeFakeGmail({ messages: inbound(4), deleted: new Set(["m1"]) })
		const pages = await withAdapter(fake, (adapter) => walk(adapter, credentials(fake)))

		expect(pages.flatMap((page) => page.ops).map((op) => (op as RecordEmail).externalId)).toEqual([
			"m0",
			"m2",
			"m3",
		])
	})

	it("stops pulls on a revoked grant, with a message that says to reconnect", async () => {
		const fake = makeFakeGmail({ messages: inbound(2) })
		const error = await withAdapter(fake, (adapter) =>
			Effect.flip(
				adapter.pull({ credentials: credentials(fake, "1//revoked"), cursor: null, since: null }),
			),
		)
		expect(error.code).toBe("auth")
		expect(error.message).toContain("reconnect Gmail")
	})

	it("retries Gmail's quota 403 (however long its message) and a failing or cut-off read; stops on a refused scope", async () => {
		const quota = makeFakeGmail({ messages: inbound(2), quota: true })
		const limited = await withAdapter(quota, (adapter) =>
			Effect.flip(adapter.pull({ credentials: credentials(quota), cursor: null, since: null })),
		)
		expect([limited.code, limited.retryAfterMs]).toEqual(["rate_limited", 60_000])

		const scope = makeFakeGmail({ messages: inbound(2), forbidden: true })
		const refused = await withAdapter(scope, (adapter) =>
			Effect.flip(adapter.pull({ credentials: credentials(scope), cursor: null, since: null })),
		)
		expect([refused.code, refused.httpStatus]).toEqual(["auth", 403])

		const failing = makeFakeGmail({ messages: inbound(2), failing: new Set(["m1"]) })
		const outage = await withAdapter(failing, (adapter) =>
			Effect.flip(adapter.pull({ credentials: credentials(failing), cursor: null, since: null })),
		)
		expect([outage.code, outage.httpStatus, outage.retryable]).toEqual(["provider", 503, undefined])

		const reset = makeFakeGmail({ messages: inbound(2), cut: new Set(["m1"]) })
		const dropped = await withAdapter(reset, (adapter) =>
			Effect.flip(adapter.pull({ credentials: credentials(reset), cursor: null, since: null })),
		)
		expect([dropped.code, dropped.retryable]).toEqual(["network", undefined])
	})

	it("reads a body Gmail did not inline by its attachment id, never a real attachment", async () => {
		const large = message({
			id: "big",
			from: "grace@globex.io",
			to: "ada@hazel.sh",
			body: multipart("multipart/mixed", [
				{
					mimeType: "text/plain",
					filename: "",
					headers: [],
					body: { attachmentId: "body-1", size: 250_000 },
				},
				{
					mimeType: "application/pdf",
					filename: "quote.pdf",
					headers: [],
					body: { attachmentId: "pdf-1" },
				},
			]),
		})
		const fake = makeFakeGmail({
			messages: [large],
			attachments: new Map([
				["body-1", "The whole long body"],
				["pdf-1", "%PDF-1.7"],
			]),
		})
		const pages = await withAdapter(fake, (adapter) => walk(adapter, credentials(fake)))

		expect(pages[0]?.ops[0]).toMatchObject({ bodyText: "The whole long body" })
		expect(fake.calls.filter((call) => call.includes("/attachments/"))).toEqual([
			"GET https://gmail.googleapis.com/gmail/v1/users/me/messages/big/attachments/body-1",
		])
	})

	it("retries a token answer cut off in transit, not a whole one that is not JSON", async () => {
		const cut = makeFakeGmail({ messages: inbound(1), tokenBody: "cut" })
		const dropped = await withAdapter(cut, (adapter) =>
			Effect.flip(adapter.pull({ credentials: credentials(cut), cursor: null, since: null })),
		)
		expect([dropped.code, dropped.retryable]).toEqual(["network", undefined])

		const garbled = makeFakeGmail({ messages: inbound(1), tokenBody: "garbled" })
		const unreadable = await withAdapter(garbled, (adapter) =>
			Effect.flip(adapter.pull({ credentials: credentials(garbled), cursor: null, since: null })),
		)
		expect([unreadable.code, unreadable.retryable]).toEqual(["provider", false])
	})

	it("answers a retryable error when the server has no Google OAuth client", async () => {
		const fake = makeFakeGmail({ messages: inbound(1) })
		const error = await withAdapter(
			fake,
			(adapter) =>
				Effect.flip(adapter.pull({ credentials: credentials(fake), cursor: null, since: null })),
			Layer.empty,
		)
		expect([error.code, error.message]).toEqual([
			"provider",
			"Gmail is not configured on this Hazel server (Google OAuth client missing)",
		])
		expect(fake.calls).toEqual([])
	})

	it("validates to the mailbox's lowercased address", async () => {
		const fake = makeFakeGmail()
		const account = await withAdapter(fake, (adapter) => adapter.validate(credentials(fake)))
		expect(account).toEqual({ externalAccountId: "ada@hazel.sh", externalAccountName: "Ada@Hazel.sh" })
	})
})
