/**
 * The api Worker's platform services: what `index.ts` supplies on Bun (a SQLite file, Redis
 * caches, `ConfigProvider.fromEnv`), rebuilt over Cloudflare bindings.
 */
import type { D1Database, KVNamespace } from "@cloudflare/workers-types"
import { Database } from "@hazel/db"
import { layerKvResultPersistence } from "@hazel/effect-cloudflare"
import { workerEnvLayer } from "@hazel/infra/worker-runtime"
import { Layer } from "effect"
import { type BotGatewayNamespace, BotGatewayTransport } from "../services/bot-gateway-transport"
import { InviteMailer, isEmailBinding } from "../services/invite-mailer"

/** KV namespace backing the session/user-lookup caches (Redis on Bun). */
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
export const DIRECTORY_DB_BINDING = "DIRECTORY_DB"

/** The directory database and the auth storage's `SqlClient` over it; suspended like the KV. */
const directoryDatabaseLive = (env: Record<string, unknown>) =>
	Layer.suspend(() => {
		const db = env[DIRECTORY_DB_BINDING]
		if (db === undefined) {
			throw new Error(`${DIRECTORY_DB_BINDING} D1 binding is missing from the Worker env`)
		}
		return Database.layerD1(db as D1Database)
	})

const cacheNamespace = (env: Record<string, unknown>): KVNamespace => {
	const kv = env[CACHE_BINDING]
	if (kv === undefined) throw new Error(`${CACHE_BINDING} KV binding is missing from the Worker env`)
	return kv as KVNamespace
}

/** Platform services for an api request graph. */
export const requestPlatformLive = (env: Record<string, unknown>, botGateways: BotGatewayNamespace) =>
	Layer.mergeAll(
		directoryDatabaseLive(env),
		BotGatewayTransport.layerDurableObject(botGateways),
		// Suspended: init also runs at plan time, where the KV binding does not exist yet.
		Layer.suspend(() => layerKvResultPersistence(cacheNamespace(env))),
		inviteMailerLive(env).pipe(Layer.provide(workerEnvLayer(env))),
		workerEnvLayer(env),
	)

/** Platform services for a Durable Object. */
export const objectPlatformLive = (env: Record<string, unknown>, botGateways: BotGatewayNamespace) =>
	Layer.mergeAll(
		BotGatewayTransport.layerDurableObject(botGateways),
		directoryDatabaseLive(env),
		layerKvResultPersistence(cacheNamespace(env)),
		workerEnvLayer(env),
	)
