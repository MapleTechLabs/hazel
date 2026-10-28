/**
 * The api Worker's platform services over its Cloudflare bindings: the directory D1, the KV caches,
 * the bot gateway namespace and the env as `ConfigProvider`.
 */
import type { D1Database, KVNamespace } from "@cloudflare/workers-types"
import { Database } from "@hazel/db"
import { layerKvResultPersistence } from "@hazel/effect-cloudflare"
import { DIRECTORY_DB_BINDING } from "@hazel/infra/cloudflare"
import { workerEnvLayer } from "@hazel/infra/worker-runtime"
import { Layer } from "effect"
import { type BotGatewayNamespace, BotGatewayTransport } from "../services/bot-gateway-transport"
import { InviteMailer, isEmailBinding } from "../services/invite-mailer"

/** KV namespace backing the session/user-lookup caches. */
export const CACHE_BINDING = "CACHE"

/** Cloudflare Email Sending, for invitation emails. */
export const EMAIL_BINDING = "EMAIL"

/** Invites go out through the `EMAIL` binding; without it the link is only logged. */
const inviteMailerLive = (env: Record<string, unknown>) =>
	Layer.suspend(() => {
		const binding = env[EMAIL_BINDING]
		return isEmailBinding(binding) ? InviteMailer.layerBinding(binding) : InviteMailer.layerLog
	})

/** The directory D1 database (users, auth, bots, routing indexes). */
export { DIRECTORY_DB_BINDING }

/** The directory database and the auth storage's `SqlClient` over it; suspended like the KV. */
const directoryDatabaseLive = (env: Record<string, unknown>) =>
	Layer.suspend(() => Database.layerD1(directoryBinding(env)))

const cacheNamespace = (env: Record<string, unknown>): KVNamespace => {
	const kv = env[CACHE_BINDING]
	if (kv === undefined) throw new Error(`${CACHE_BINDING} KV binding is missing from the Worker env`)
	return kv as KVNamespace
}

/** The `DIRECTORY_DB` binding off a Worker env. */
export const directoryBinding = (env: Record<string, unknown>): D1Database => {
	const db = env[DIRECTORY_DB_BINDING]
	if (db === undefined) throw new Error(`${DIRECTORY_DB_BINDING} D1 binding is missing from the Worker env`)
	return db as D1Database
}

/**
 * What the app services read besides `Database`: bot gateway transport, the KV caches, the
 * invite mailer and the env as `ConfigProvider`. Objects run these over their own SQLite.
 */
export const servicesPlatformLive = (env: Record<string, unknown>, botGateways: BotGatewayNamespace) =>
	Layer.mergeAll(
		BotGatewayTransport.layerDurableObject(botGateways),
		// Suspended: init also runs at plan time, where the KV binding does not exist yet.
		Layer.suspend(() => layerKvResultPersistence(cacheNamespace(env))),
		inviteMailerLive(env).pipe(Layer.provide(workerEnvLayer(env))),
		workerEnvLayer(env),
	)

/** Platform services for an api request graph: the directory (D1) is its `Database`. */
export const requestPlatformLive = (env: Record<string, unknown>, botGateways: BotGatewayNamespace) =>
	Layer.mergeAll(directoryDatabaseLive(env), servicesPlatformLive(env, botGateways))

/** Platform services for a Durable Object. */
export const objectPlatformLive = (env: Record<string, unknown>, botGateways: BotGatewayNamespace) =>
	Layer.mergeAll(
		BotGatewayTransport.layerDurableObject(botGateways),
		directoryDatabaseLive(env),
		layerKvResultPersistence(cacheNamespace(env)),
		workerEnvLayer(env),
	)
