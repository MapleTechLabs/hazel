/**
 * The api Worker's fetch handler: `/health` and CORS preflights answer before the route graph
 * exists; the rest waits for the graph (`./http.ts`), which `worker.ts` imports on demand so a
 * cold isolate (a Durable Object's included) never evaluates it before it is needed.
 */
import { workerEnvLayer } from "@hazel/infra/worker-runtime"
import * as Cloudflare from "@alchemy.run/cloudflare"
import type { HttpEffect } from "alchemy/Http"
import { RuntimeContext } from "alchemy/RuntimeContext"
import { Effect } from "effect"
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from "effect/http"
import { corsPolicy } from "../lib/cors"
import { takeIsolateCold } from "./cold-start"

const pathOf = (url: string): string => {
	const query = url.indexOf("?")
	return query === -1 ? url : url.slice(0, query)
}

/**
 * A CORS preflight's answer, from the policy the router applies (`lib/cors.ts`): the same
 * middleware, over the Worker's env instead of the graph's `ConfigProvider`.
 */
const makePreflight = (env: Record<string, unknown>) => {
	let cors: ReturnType<typeof HttpMiddleware.cors> | undefined
	return Effect.gen(function* () {
		cors ??= HttpMiddleware.cors(
			yield* corsPolicy.pipe(Effect.provide(workerEnvLayer(env)), Effect.orDie),
		)
		// The middleware answers every `OPTIONS` itself and never runs what it wraps.
		return yield* cors(Effect.succeed(HttpServerResponse.empty({ status: 204 })))
	})
}

/**
 * The fetch handler. `/health` and CORS preflights answer before the route graph exists; the
 * rest runs the router.
 *
 * A preflight on a cold isolate starts the graph in the background (`waitUntil`), so the request
 * it announces finds it built or being built. This takes the graph's build off the preflight,
 * not the isolate's own start (the script's evaluation), which every first request still pays.
 */
export const makeFetch = (app: Effect.Effect<HttpEffect, unknown>, env: Record<string, unknown>) => {
	const preflight = makePreflight(env)
	// One macrotask later: the build starts with a stretch of CPU, which would otherwise run
	// before the preflight's answer leaves.
	const afterAnswer = Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
	let built = false
	const ready = app.pipe(
		Effect.orDie,
		Effect.tap(() =>
			Effect.sync(() => {
				built = true
			}),
		),
	)
	return Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest
		yield* Effect.annotateCurrentSpan("isolate.cold", takeIsolateCold())
		if (request.method === "GET" && pathOf(request.url) === "/health") {
			return HttpServerResponse.text("OK")
		}
		if (request.method === "OPTIONS" && request.headers["access-control-request-method"] !== undefined) {
			// A failed build is retried by the request that needs it (`cachedRecoverable`).
			if (!built) {
				yield* Cloudflare.waitUntil(Effect.exit(Effect.andThen(afterAnswer, ready))).pipe(
					Effect.provide(RuntimeContext.phantom),
				)
			}
			return yield* preflight
		}
		// The wait for the graph, as a span of its own: its build runs under the isolate's
		// context, so nothing inside it is traced.
		const handler = built ? yield* ready : yield* ready.pipe(Effect.withSpan("Api.buildRoutes"))
		return yield* handler
	})
}
