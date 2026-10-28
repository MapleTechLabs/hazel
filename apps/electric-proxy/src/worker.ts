/**
 * The electric-proxy Worker: authenticates Hazel users (access tokens) and bots, pins each shape's where-clause
 * and forwards to Electric, streaming the response through. Electric is the self-hosted
 * container's Durable Object (`ELECTRIC`), or `ELECTRIC_URL` (docker Electric under `alchemy dev`).
 */
import { ProxyAuth } from "@hazel/auth/proxy"
import { Database } from "@hazel/db"
import { layerKvResultPersistence } from "@hazel/effect-cloudflare/KvPersistence"
import { cachedRecoverable } from "@hazel/infra/cached-recoverable"
import { HAZEL_DB_BINDING, HazelStack, hazelWorkerProps } from "@hazel/infra/cloudflare"
import { derived, merge, optionalPlain, telemetryEnv } from "@hazel/infra/env"
import { hazelTelemetry } from "@hazel/infra/maple"
import { forIsolate, isolateContext } from "@hazel/infra/worker-http"
import { workerEnvLayer } from "@hazel/infra/worker-runtime"
import type { D1Database, KVNamespace } from "@cloudflare/workers-types"
import * as Cloudflare from "alchemy/Cloudflare"
import { Config, Effect, Layer, Logger, Option, Redacted, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { electricProxyEnv, mapleObservability, ProxyCache } from "../resources.ts"
import { AccessContextCacheService } from "./cache"
import { handleRequest } from "./handler"
import { type ElectricNamespace, ElectricUpstream } from "./proxy/electric-upstream"

/** KV namespace backing the bot access-context cache (was Redis). */
const PROXY_CACHE_BINDING = "PROXY_CACHE"
/** The Electric container's Durable Object namespace, bound from the `electric` Worker. */
const ELECTRIC_BINDING = "ELECTRIC"

/** `__ALCHEMY_RUNTIME__` folds to `true` in the bundle, so the stack-side branch is tree-shaken. */
const props = Effect.gen(function* () {
	if (globalThis.__ALCHEMY_RUNTIME__) return { main: import.meta.url }
	const stack = yield* HazelStack
	const { stage, domains } = stack
	return {
		main: import.meta.url,
		...hazelWorkerProps("electric-proxy", stack),
		workersDev: stage.kind !== "prd",
		// Same hostname as the Railway deployment, so the web app's VITE_ELECTRIC_URL is unchanged.
		domain: domains.electric,
		// Traces reach Maple through the SDK (`hazelTelemetry`), not the Cloudflare destination.
		observability: {
			...mapleObservability,
			traces: { enabled: true, persist: true, headSamplingRate: 1 },
		},
		env: {
			[HAZEL_DB_BINDING]: stack.db.hyperdrive,
			[PROXY_CACHE_BINDING]: yield* ProxyCache,
			...(yield* electricProxyEnv(stack)),
			...(yield* merge(
				// Access tokens are issued and signed by the API; the public keys come from its
				// JWKS, or inline for a plain-HTTP dev API (`generate-keys` prints them).
				derived("API_BASE_URL", stack.urls.api),
				optionalPlain("AUTH_ACCESS_TOKEN_JWKS"),
				telemetryEnv(stage),
			)),
		},
	}
})

/** A binding the deploy should have attached is missing or of the wrong kind. */
export class ProxyBindingError extends Schema.TaggedError<ProxyBindingError>()("ProxyBindingError", {
	message: Schema.String,
	binding: Schema.String,
}) {}

const isKvNamespace = (value: unknown): value is KVNamespace =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { get?: unknown }).get === "function" &&
	typeof (value as { put?: unknown }).put === "function"

const isElectricNamespace = (value: unknown): value is ElectricNamespace =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { getByName?: unknown }).getByName === "function"

/** The container's namespace when bound, else `ELECTRIC_URL`, else a 503 upstream. */
const electricUpstreamLayer = (env: Record<string, unknown>) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const secret = yield* Config.option(Config.Redacted("ELECTRIC_SECRET"))
			const authParams = Option.match(secret, {
				onNone: () => ({}),
				onSome: (value) => ({ secret: Redacted.value(value) }),
			})
			const namespace = env[ELECTRIC_BINDING]
			if (isElectricNamespace(namespace)) {
				return ElectricUpstream.layerDurableObject(namespace, authParams)
			}
			const electricUrl = yield* Config.option(Config.String("ELECTRIC_URL"))
			return Option.match(electricUrl, {
				onNone: () => ElectricUpstream.layerUnconfigured,
				onSome: (baseUrl) => ElectricUpstream.layerUrl({ baseUrl, authParams }),
			})
		}),
	)

/** The directory D1 database. The proxy is removed with Electric; it reads no other store. */
const DIRECTORY_DB_BINDING = "DIRECTORY_DB"

/**
 * The per-isolate services. The bot access-context cache is built per request, since its
 * in-flight lookups would otherwise be shared across requests' I/O contexts.
 */
const isolateLayer = (env: Record<string, unknown>) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const kv = env[PROXY_CACHE_BINDING]
			if (!isKvNamespace(kv)) {
				return yield* new ProxyBindingError({
					message: "The proxy cache KV namespace is not bound",
					binding: PROXY_CACHE_BINDING,
				})
			}
			const directory = env[DIRECTORY_DB_BINDING]
			if (directory === undefined) {
				return yield* new ProxyBindingError({
					message: "The directory D1 database is not bound",
					binding: DIRECTORY_DB_BINDING,
				})
			}
			return Layer.mergeAll(ProxyAuth.layer, electricUpstreamLayer(env)).pipe(
				Layer.provideMerge(Database.layerD1(directory as D1Database)),
				Layer.provideMerge(layerKvResultPersistence(kv)),
			)
		}),
	).pipe(
		Layer.provideMerge(Logger.layer([Logger.withConsoleLog(Logger.formatStructured)])),
		Layer.provideMerge(workerEnvLayer(env)),
	)

export default class ElectricProxy extends Cloudflare.Worker<ElectricProxy>()(
	"electric-proxy",
	props,
	Effect.gen(function* () {
		const env: Record<string, unknown> = yield* Cloudflare.WorkerEnvironment
		const isolate = isolateContext(yield* Effect.context<never>())

		// Built on the first request, not in init (init also runs at plan time, where every
		// `Config` read would be auto-bound). A failed build answers 500 and the next request retries.
		const services = yield* cachedRecoverable(
			forIsolate(isolate)(Layer.build(isolateLayer(env))).pipe(Effect.orDie),
		)

		return {
			fetch: Effect.gen(function* () {
				const context = yield* services
				const request = yield* HttpServerRequest.toWeb(yield* HttpServerRequest.HttpServerRequest)
				const response = yield* handleRequest(request).pipe(
					Effect.provide(AccessContextCacheService.layer, { local: true }),
					Effect.provideContext(context),
				)
				// Raw passthrough: the bridge returns this Response as-is, so the body streams unbuffered.
				return HttpServerResponse.raw(response, { status: response.status })
			}).pipe(Effect.orDie),
		}
	}).pipe(Effect.provide(hazelTelemetry("electric-proxy"))),
) {}
