/**
 * `GET /html-renders/...`: serves a page only for a valid, unexpired signature over its exact
 * location, always with the sandbox CSP.
 */
import { HTML_RENDER_CONTENT_SECURITY_POLICY } from "@hazel/domain/html-render"
import type { ChannelId, HtmlRenderId, UserId } from "@hazel/schema"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { HttpRouter } from "effect/http"
import { describe, expect, it } from "vitest"
import {
	HtmlRenderStore,
	HtmlRenderStoreError,
	HtmlRenders,
	type HtmlRenderLocation,
	htmlRenderKey,
	pendingHtmlRenderKey,
} from "../services/html-renders"
import { HtmlRenderRoute } from "./html-render-route"

const PAGE = "<!doctype html><p>chart</p>"

const setup = (options: { readonly storageDown?: boolean } = {}) => {
	const bucket = new Map<string, string>()
	const renders = Layer.effect(HtmlRenders, HtmlRenders.make).pipe(
		Layer.provide(
			Layer.succeed(HtmlRenderStore, {
				put: (key, body) => Effect.sync(() => void bucket.set(key, body)),
				getText: (key) =>
					options.storageDown
						? Effect.fail(new HtmlRenderStoreError({ message: "down" }))
						: Effect.sync(() => Option.fromNullishOr(bucket.get(key))),
				remove: (key) => Effect.sync(() => void bucket.delete(key)),
			}),
		),
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					API_BASE_URL: "http://api.test",
					S3_SECRET_ACCESS_KEY: "secret",
				}),
			),
		),
	)
	const web = HttpRouter.toWebHandler(HtmlRenderRoute.pipe(Layer.provide(renders)), { disableLogger: true })
	const fetch = (url: string) => (web.handler as (request: Request) => Promise<Response>)(new Request(url))
	const location: HtmlRenderLocation = {
		channelId: crypto.randomUUID() as ChannelId,
		authorId: crypto.randomUUID() as UserId,
		renderId: crypto.randomUUID() as HtmlRenderId,
	}
	bucket.set(htmlRenderKey(location), PAGE)
	const sign = (at: HtmlRenderLocation) =>
		Effect.runPromise(
			HtmlRenders.use((service) => service.signedUrl(at)).pipe(Effect.provide(renders), Effect.orDie),
		).then((signed) => signed.url)
	return { fetch, location, sign, bucket }
}

describe("HtmlRenderRoute", () => {
	it("serves the page sandboxed for a valid signature", async () => {
		const { fetch, location, sign } = setup()
		const response = await fetch(await sign(location))
		expect(response.status).toBe(200)
		expect(await response.text()).toBe(PAGE)
		expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
		expect(response.headers.get("content-security-policy")).toBe(HTML_RENDER_CONTENT_SECURITY_POLICY)
		expect(response.headers.get("x-content-type-options")).toBe("nosniff")
		expect(response.headers.get("referrer-policy")).toBe("no-referrer")
		expect(response.headers.get("cache-control")).toMatch(/^private, max-age=\d+$/)
	})

	it("refuses a tampered, moved or unsigned URL", async () => {
		const { fetch, location, sign } = setup()
		const url = new URL(await sign(location))
		const tampered = new URL(url)
		tampered.searchParams.set("exp", String(Number(url.searchParams.get("exp")) + 60_000))
		expect((await fetch(tampered.toString())).status).toBe(403)

		// Alice's copy of the reference names her as publisher: signed, but nothing is stored there.
		const other = { ...location, authorId: crypto.randomUUID() as UserId }
		expect((await fetch(await sign(other))).status).toBe(404)
		const moved = url.toString().replace(location.authorId, other.authorId)
		expect((await fetch(moved)).status).toBe(403)

		expect((await fetch(url.toString().split("?")[0]!)).status).toBe(403)
		expect((await fetch("http://api.test/html-renders/not-a-uuid/x/y?exp=1&sig=x")).status).toBe(404)
		expect((await fetch(`http://api.test/html-renders/${location.channelId}/../etc?exp=1`)).status).toBe(
			404,
		)
	})

	it("serves a page its message has not claimed yet", async () => {
		const { fetch, location, sign, bucket } = setup()
		bucket.delete(htmlRenderKey(location))
		bucket.set(pendingHtmlRenderKey(location), PAGE)
		const response = await fetch(await sign(location))
		expect(response.status).toBe(200)
		expect(await response.text()).toBe(PAGE)
	})

	it("answers 503 when the bucket is unavailable", async () => {
		const { fetch, location, sign } = setup({ storageDown: true })
		expect((await fetch(await sign(location))).status).toBe(503)
	})
})
