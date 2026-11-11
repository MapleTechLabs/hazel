import { HTML_RENDER_MAX_BYTES } from "@hazel/domain/html-render"
import type { ChannelId, HtmlRenderId, UserId } from "@hazel/schema"
import { ConfigProvider, Effect, Exit, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"
import {
	HTML_RENDER_URL_TTL_MS,
	HtmlRenderStore,
	HtmlRenders,
	htmlRenderKey,
	pendingHtmlRenderKey,
} from "./html-renders"

const channelId = crypto.randomUUID() as ChannelId
const authorId = crypto.randomUUID() as UserId

const makeLayer = (bucket: Map<string, string>, secret = "bucket-secret") =>
	Layer.effect(HtmlRenders, HtmlRenders.make).pipe(
		Layer.provide(
			Layer.succeed(HtmlRenderStore, {
				put: (key, body) => Effect.sync(() => void bucket.set(key, body)),
				getText: (key) => Effect.sync(() => Option.fromNullishOr(bucket.get(key))),
				remove: (key) => Effect.sync(() => void bucket.delete(key)),
			}),
		),
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					API_BASE_URL: "https://api.test/",
					S3_SECRET_ACCESS_KEY: secret,
				}),
			),
		),
	)

const run = <A, E>(effect: Effect.Effect<A, E, HtmlRenders>, bucket = new Map<string, string>()) =>
	Effect.runPromise(effect.pipe(Effect.provide(makeLayer(bucket))) as Effect.Effect<A, E>)

const signatureOf = (url: string) => {
	const parsed = new URL(url)
	return { expiresAt: Number(parsed.searchParams.get("exp")), signature: parsed.searchParams.get("sig")! }
}

describe("HtmlRenders", () => {
	it("stores the page with the bootstrap and returns its reference", async () => {
		const bucket = new Map<string, string>()
		const reference = await run(
			HtmlRenders.use((renders) =>
				renders.publish({
					channelId,
					authorId,
					title: "  Chart  ",
					html: "<h1>Hi</h1>",
					height: 5000,
				}),
			),
			bucket,
		)
		expect(reference.title).toBe("Chart")
		expect(reference.height).toBe(2000)
		const location = { channelId, authorId, renderId: reference.renderId }
		// Pending until a message claims it.
		expect(bucket.has(htmlRenderKey(location))).toBe(false)
		const page = bucket.get(pendingHtmlRenderKey(location))!
		expect(page).toContain('<style id="hazel-theme">')
		expect(page).toContain("<h1>Hi</h1>")
	})

	it("claims a pending page once, reads it before and after, and removes either", async () => {
		const bucket = new Map<string, string>()
		const location = { channelId, authorId, renderId: crypto.randomUUID() as HtmlRenderId }
		bucket.set(pendingHtmlRenderKey(location), "<p>page</p>")
		const result = await run(
			Effect.gen(function* () {
				const renders = yield* HtmlRenders
				const beforeClaim = yield* renders.read(location)
				yield* renders.claim(location)
				// A second claim (a reused reference) finds nothing pending and keeps the page.
				yield* renders.claim(location)
				const afterClaim = yield* renders.read(location)
				const keys = [...bucket.keys()]
				yield* renders.remove(location)
				return { beforeClaim, afterClaim, keys, left: bucket.size }
			}),
			bucket,
		)
		expect(Option.getOrNull(result.beforeClaim)).toBe("<p>page</p>")
		expect(Option.getOrNull(result.afterClaim)).toBe("<p>page</p>")
		expect(result.keys).toEqual([htmlRenderKey(location)])
		expect(result.left).toBe(0)
	})

	it("refuses viewport height units and oversized pages", async () => {
		const publish = (html: string) =>
			run(
				Effect.exit(
					HtmlRenders.use((renders) =>
						renders.publish({ channelId, authorId, title: "x", html, height: 200 }),
					),
				),
			)
		const viewport = await publish("<style>.a{min-height:100vh}</style>")
		expect(Exit.isFailure(viewport) && String(viewport.cause)).toContain("100vh")
		const large = await publish("é".repeat(HTML_RENDER_MAX_BYTES / 2 + 1))
		expect(Exit.isFailure(large)).toBe(true)
		// A base64 run that happens to contain "1vh" is not CSS.
		const inlined = await publish("<style>.a{background:url(data:image/png;base64,AB1vhCD)}</style>")
		expect(Exit.isSuccess(inlined)).toBe(true)
	})

	it("signs URLs it verifies until they expire, for that location only", async () => {
		const location = { channelId, authorId, renderId: crypto.randomUUID() as HtmlRenderId }
		const results = await run(
			Effect.gen(function* () {
				const renders = yield* HtmlRenders
				const { url, expiresAt } = yield* renders.signedUrl(location)
				const { signature } = signatureOf(url)
				const verify = (at: typeof location, exp = expiresAt, sig = signature) =>
					renders.verify(at, exp, sig)
				const valid = yield* verify(location)
				const otherChannel = yield* verify({
					...location,
					channelId: crypto.randomUUID() as ChannelId,
				})
				const otherAuthor = yield* verify({ ...location, authorId: crypto.randomUUID() as UserId })
				const extended = yield* verify(location, expiresAt + 1000)
				const garbage = yield* verify(location, expiresAt, "not*base64")
				yield* TestClock.adjust(HTML_RENDER_URL_TTL_MS + 1)
				const expired = yield* verify(location)
				return { url, valid, otherChannel, otherAuthor, extended, garbage, expired }
			}).pipe(Effect.provide(TestClock.layer())),
		)
		expect(
			results.url.startsWith(
				`https://api.test/html-renders/${channelId}/${authorId}/${location.renderId}?exp=`,
			),
		).toBe(true)
		expect(results).toMatchObject({
			valid: true,
			otherChannel: false,
			otherAuthor: false,
			extended: false,
			garbage: false,
			expired: false,
		})
	})

	it("does not accept a signature made with another bucket secret", async () => {
		const location = { channelId, authorId, renderId: crypto.randomUUID() as HtmlRenderId }
		const signed = await Effect.runPromise(
			HtmlRenders.use((renders) => renders.signedUrl(location)).pipe(
				Effect.provide(makeLayer(new Map(), "other-secret")),
			),
		)
		const { expiresAt, signature } = signatureOf(signed.url)
		const valid = await run(HtmlRenders.use((renders) => renders.verify(location, expiresAt, signature)))
		expect(valid).toBe(false)
	})
})
