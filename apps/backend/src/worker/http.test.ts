/**
 * The api Worker's fetch handler: a CORS preflight is answered from the router's policy before the
 * route graph exists, and starts the graph for the request it announces; the cold-start marks.
 */
import { cachedRecoverable } from "@hazel/infra/cached-recoverable"
import * as Cloudflare from "@alchemy.run/cloudflare"
import type { HttpEffect } from "alchemy/Http"
import { Context, Effect, type Scope, Tracer } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { describe, expect, it, vi } from "vitest"
import { buildApp, makeFetch } from "./http"
import { makeFakeApiEnv } from "./http-testing"

const appOrigin = "https://app-pr-7.hazel.sh"
const env = { FRONTEND_URL: appOrigin }

/** One Worker event: its `waitUntil` promises, and the spans its request records. */
const makeEvent = () => {
	const background: Array<Promise<unknown>> = []
	const spans: Array<Tracer.NativeSpan> = []
	const context = Context.make(Cloudflare.WorkerExecutionContext, {
		waitUntil: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			Effect.map(Effect.context<R>(), (services) => {
				background.push(Effect.runPromiseWith(services)(effect))
			}),
	} as never).pipe(
		Context.add(
			Tracer.Tracer,
			Tracer.make({
				span: (span) => {
					const recorded = new Tracer.NativeSpan(span)
					spans.push(recorded)
					return recorded
				},
			}),
		),
	)
	return { background, spans, context }
}

type Fetch = Effect.Effect<
	HttpServerResponse.HttpServerResponse,
	unknown,
	HttpServerRequest.HttpServerRequest | Scope.Scope
>

/** Runs `request` through `fetch` as one event, under the span the HTTP server gives a request. */
const send = async (fetch: Fetch, request: Request, event = makeEvent()) => {
	const response = await Effect.runPromise(
		fetch.pipe(
			Effect.withSpan("http.server"),
			Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request)),
			Effect.scoped,
			Effect.provideContext(event.context),
		) as Effect.Effect<HttpServerResponse.HttpServerResponse>,
	)
	const requestSpan = event.spans.find((span) => span.name === "http.server")!
	return { response: HttpServerResponse.toWeb(response), event, attributes: requestSpan.attributes }
}

const preflight = (origin: string, path = "/rpc") =>
	new Request(`https://api.test${path}`, {
		method: "OPTIONS",
		headers: {
			origin,
			"access-control-request-method": "POST",
			"access-control-request-headers": "content-type, x-effect-auth-csrf",
		},
	})

const headersOf = (response: Response) => Object.fromEntries(response.headers)

/** A graph that is one handler, built when `release` is called; `builds` counts the attempts. */
const gatedApp = () => {
	let release!: () => void
	const gate = new Promise<void>((resolve) => {
		release = resolve
	})
	const state = { builds: 0, release }
	const handler: HttpEffect = Effect.succeed(HttpServerResponse.text("routed"))
	const app = Effect.promise(() => {
		state.builds++
		return gate.then(() => handler)
	})
	return { state, app }
}

describe("api fetch handler", () => {
	it("marks the isolate's first request cold, and no later one", async () => {
		vi.resetModules()
		const fresh = await import("./http")
		const fetch = fresh.makeFetch(Effect.succeed(Effect.succeed(HttpServerResponse.text("routed"))), env)
		const health = new Request("https://api.test/health")
		expect((await send(fetch, health)).attributes.get("isolate.cold")).toBe(true)
		expect((await send(fetch, health)).attributes.get("isolate.cold")).toBe(false)
		expect((await send(fetch, preflight(appOrigin))).attributes.get("isolate.cold")).toBe(false)
	})

	it("answers a preflight without the graph, and starts the graph in the background", async () => {
		const { state, app } = gatedApp()
		const fetch = makeFetch(cached(cachedRecoverable(app)), env)

		const first = await send(fetch, preflight(appOrigin))
		expect(first.response.status).toBe(204)
		expect(first.response.headers.get("access-control-allow-origin")).toBe(appOrigin)
		// Answered before the build starts; it then runs under the event's `waitUntil`.
		expect(state.builds).toBe(0)
		expect(first.event.background).toHaveLength(1)
		await new Promise((resolve) => setTimeout(resolve, 5))
		expect(state.builds).toBe(1)

		// The request it announced waits for that same build, under a span of its own.
		const routed = send(fetch, new Request("https://api.test/rpc", { method: "POST" }))
		state.release()
		const { response, event } = await routed
		expect(await response.text()).toBe("routed")
		expect(state.builds).toBe(1)
		expect(event.spans.map((span) => span.name)).toContain("Api.buildRoutes")
		await Promise.all(first.event.background)

		// Built: a preflight starts nothing, and a request no longer waits.
		const later = await send(fetch, preflight(appOrigin))
		expect(later.event.background).toEqual([])
		const warm = await send(fetch, new Request("https://api.test/rpc", { method: "POST" }))
		expect(warm.event.spans.map((span) => span.name)).not.toContain("Api.buildRoutes")
		expect(state.builds).toBe(1)
	})

	it("answers a preflight whose background build fails; the next request builds again", async () => {
		let builds = 0
		const app = Effect.suspend(() =>
			++builds === 1
				? Effect.fail("D1 down")
				: Effect.succeed<HttpEffect>(Effect.succeed(HttpServerResponse.text("routed"))),
		)
		const fetch = makeFetch(cached(cachedRecoverable(app)), env)
		const first = await send(fetch, preflight(appOrigin))
		expect(first.response.status).toBe(204)
		await Promise.all(first.event.background)
		const { response } = await send(fetch, new Request("https://api.test/rpc", { method: "POST" }))
		expect(await response.text()).toBe("routed")
		expect(builds).toBe(2)
	})

	it("gives a disallowed origin no allow-origin", async () => {
		const { app } = gatedApp()
		const fetch = makeFetch(app, env)
		const { response } = await send(fetch, preflight("https://evil.test"))
		expect(response.status).toBe(204)
		expect(response.headers.get("access-control-allow-origin")).toBeNull()
		// Another stage's app is not this stage's.
		const other = await send(fetch, preflight("https://app-pr-8.hazel.sh"))
		expect(other.response.headers.get("access-control-allow-origin")).toBeNull()
	})

	it("leaves an OPTIONS that is not a preflight to the router", async () => {
		const fetch = makeFetch(Effect.succeed(Effect.succeed(HttpServerResponse.text("routed"))), env)
		const { response, event } = await send(
			fetch,
			new Request("https://api.test/rpc", { method: "OPTIONS", headers: { origin: appOrigin } }),
		)
		expect(await response.text()).toBe("routed")
		expect(event.background).toEqual([])
	})

	it("answers a preflight as the built graph's router does", async () => {
		const { env: apiEnv } = await makeFakeApiEnv({ frontendUrl: appOrigin })
		const app = cached(
			cachedRecoverable(buildApp(Context.empty(), apiEnv, {} as never, {} as never, {} as never)),
		)
		const fetch = makeFetch(app, apiEnv)
		for (const origin of [appOrigin, "https://app.hazel.sh", "tauri://localhost", "https://evil.test"]) {
			const before = await send(fetch, preflight(origin))
			await Promise.all(before.event.background)
			// The router's own answer: the built graph, run without the fetch handler in front.
			const router = await send(Effect.flatten(app) as Fetch, preflight(origin))
			expect(before.response.status).toBe(router.response.status)
			expect(headersOf(before.response)).toEqual(headersOf(router.response))
			const after = await send(fetch, preflight(origin))
			expect(headersOf(after.response)).toEqual(headersOf(before.response))
		}
		const allowed = await send(fetch, preflight(appOrigin))
		expect(headersOf(allowed.response)).toMatchObject({
			"access-control-allow-origin": appOrigin,
			"access-control-allow-credentials": "true",
			"access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
			"access-control-allow-headers": "content-type, x-effect-auth-csrf",
			"access-control-max-age": "7200",
		})
	})
})

/** `cachedRecoverable` hands back the cached effect; the Worker's init yields it the same way. */
function cached<A, E>(effect: Effect.Effect<Effect.Effect<A, E>>): Effect.Effect<A, E> {
	return Effect.runSync(effect)
}
