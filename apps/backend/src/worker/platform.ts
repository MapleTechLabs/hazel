/**
 * The api Worker's platform services: what `index.ts` supplies on Bun (pooled Postgres, Redis
 * caches, `ConfigProvider.fromEnv`), rebuilt over Cloudflare bindings.
 */
import type { KVNamespace } from "@cloudflare/workers-types"
import { Database } from "@hazel/db"
import { layerKvResultPersistence } from "@hazel/effect-cloudflare"
import { readHazelDbBinding } from "@hazel/infra/cloudflare"
import { workerEnvLayer } from "@hazel/infra/worker-runtime"
import { Effect, Layer, Option, Redacted } from "effect"

/** KV namespace backing the session/user-lookup caches (Redis on Bun). */
export const CACHE_BINDING = "CACHE"

/** The Hyperdrive connection string, a defect when the binding is missing. */
export const hazelDbConnectionString = (env: Record<string, unknown>): string =>
	Option.match(readHazelDbBinding(env), {
		onNone: () => {
			throw new Error("HAZEL_DB Hyperdrive binding is missing from the Worker env")
		},
		onSome: (binding) => binding.connectionString,
	})

const cacheNamespace = (env: Record<string, unknown>): KVNamespace => {
	const kv = env[CACHE_BINDING]
	if (kv === undefined) throw new Error(`${CACHE_BINDING} KV binding is missing from the Worker env`)
	return kv as KVNamespace
}

/**
 * Platform services for an api request graph. `Database` reads the per-request
 * `DatabaseConnection` the fetch handler provides (sockets are bound to the request that opened
 * them).
 */
export const requestPlatformLive = (env: Record<string, unknown>) =>
	Layer.mergeAll(
		Database.layerRequestScoped,
		layerKvResultPersistence(cacheNamespace(env)),
		workerEnvLayer(env),
	)

/**
 * Platform services for a Durable Object. A Durable Object may keep connections across the
 * calls it serves, so it holds one pooled client (through Hyperdrive) for its in-memory lifetime.
 */
export const objectPlatformLive = (env: Record<string, unknown>) =>
	Layer.mergeAll(
		Layer.unwrap(
			Effect.sync(() =>
				Database.layer({ url: Redacted.make(hazelDbConnectionString(env)), ssl: false }),
			),
		),
		layerKvResultPersistence(cacheNamespace(env)),
		workerEnvLayer(env),
	)

/** Opens the request's Postgres client; it connects lazily and is closed with the request scope. */
export const provideRequestDatabase = (env: Record<string, unknown>) =>
	Effect.provideServiceEffect(
		Database.DatabaseConnection,
		Effect.acquireRelease(
			Effect.sync(() => Database.makeRequestConnection(hazelDbConnectionString(env))),
			(connection) => Effect.promise(() => connection.end()).pipe(Effect.ignore),
		),
	)
