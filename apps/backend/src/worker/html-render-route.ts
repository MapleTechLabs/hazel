/**
 * `GET /html-renders/:channelId/:authorId/:renderId?exp=<ms>&sig=<sig>`: an HTML render's page, for the URL
 * `message.htmlRenderUrl` signed (`services/html-renders.ts`). The signature is the only check:
 * the frame that loads the page has no credentials to send (opaque origin, desktop bearer auth).
 *
 * Served with the sandbox CSP, so even opened directly the page runs in an opaque origin and
 * cannot connect anywhere (`@hazel/domain/html-render`).
 */
import { HTML_RENDER_CONTENT_SECURITY_POLICY } from "@hazel/domain/html-render"
import { ChannelId, HtmlRenderId, UserId } from "@hazel/schema"
import { Clock, Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HtmlRenders } from "../services/html-renders"

const RENDER_PATH = /^\/html-renders\/([^/?]+)\/([^/?]+)\/([^/?]+)$/
const decodeLocation = Schema.decodeUnknownOption(
	Schema.Struct({ channelId: ChannelId, authorId: UserId, renderId: HtmlRenderId }),
)

const notFound = () => HttpServerResponse.text("Not found", { status: 404 })

export const HtmlRenderRoute = HttpRouter.use((router) =>
	Effect.gen(function* () {
		// Resolved when the route is built: a handler only sees the request's own services.
		const renders = yield* HtmlRenders
		return yield* router.add(
			"GET",
			"/html-renders/*",
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				const url = new URL(request.url, "http://localhost")
				const match = RENDER_PATH.exec(url.pathname)
				const location = decodeLocation({
					channelId: match?.[1],
					authorId: match?.[2],
					renderId: match?.[3],
				})
				if (Option.isNone(location)) return notFound()

				const expiresAt = Number(url.searchParams.get("exp"))
				const valid = yield* renders.verify(
					location.value,
					expiresAt,
					url.searchParams.get("sig") ?? "",
				)
				if (!valid) return HttpServerResponse.text("Link expired", { status: 403 })

				const page = yield* renders.read(location.value)
				if (Option.isNone(page)) return notFound()

				const maxAge = Math.max(0, Math.floor((expiresAt - (yield* Clock.currentTimeMillis)) / 1000))
				return HttpServerResponse.text(page.value, {
					contentType: "text/html; charset=utf-8",
					headers: {
						"Content-Security-Policy": HTML_RENDER_CONTENT_SECURITY_POLICY,
						"X-Content-Type-Options": "nosniff",
						"Referrer-Policy": "no-referrer",
						"Cache-Control": `private, max-age=${Math.min(maxAge, 3600)}`,
					},
				})
			}).pipe(
				Effect.catchTag("HtmlRenderStoreError", (error) =>
					Effect.logError("Could not read an HTML render", { error: error.message }).pipe(
						Effect.as(HttpServerResponse.text("Unavailable", { status: 503 })),
					),
				),
				Effect.withSpan("HtmlRenderRoute.serve"),
			),
		)
	}),
)
