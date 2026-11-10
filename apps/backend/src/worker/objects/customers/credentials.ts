/**
 * A connection's credentials (`customer_connection_secrets`): encrypted with
 * `IntegrationEncryption` on connect, decrypted only to call the provider. Never synced, never
 * returned by an RPC.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { ConnectionConfig } from "@hazel/domain/customers"
import type { CustomerConnectionId } from "@hazel/schema"
import { Clock, Effect, Option, Redacted } from "effect"
import { IntegrationEncryption } from "../../../services/integration-encryption"
import type { ProviderCredentials } from "./providers"

/** Encrypt the API key and the webhook secret for storing, both under the current key version. */
export const encryptSecrets = Effect.fn("Customers.encryptSecrets")(function* (
	apiKey: string,
	webhookSecret: string | null,
) {
	const encryption = yield* IntegrationEncryption
	const key = yield* encryption.encrypt(apiKey)
	const secret = webhookSecret === null ? null : yield* encryption.encrypt(webhookSecret)
	return {
		encryptedApiKey: key.ciphertext,
		apiKeyIv: key.iv,
		encryptedWebhookSecret: secret?.ciphertext ?? null,
		webhookSecretIv: secret?.iv ?? null,
		encryptionKeyVersion: key.keyVersion,
	}
})

export const storeSecrets = Effect.fn("Customers.storeSecrets")(function* (
	connectionId: CustomerConnectionId,
	secrets: Effect.Success<ReturnType<typeof encryptSecrets>>,
) {
	const db = yield* Database.Database
	const updatedAt = new Date(yield* Clock.currentTimeMillis)
	yield* db.run(
		SQLite.insertInto(schema.customerConnectionSecretsTable)
			.values({ connectionId, ...secrets })
			.onConflictDoUpdate({ target: ["connectionId"], set: { ...secrets, updatedAt } }),
	)
})

/** Stop connections: drop their credentials, end their running sync runs, schedule no pulls. */
export const disconnectConnections = Effect.fn("Customers.disconnectConnections")(function* (
	connectionIds: ReadonlyArray<CustomerConnectionId>,
	now: Date,
) {
	if (connectionIds.length === 0) return
	const db = yield* Database.Database
	yield* db.run(
		SQLite.update(schema.customerConnectionsTable)
			.set({
				status: "disconnected",
				disconnectedAt: now,
				nextSyncAt: null,
				hasWebhookSecret: false,
				updatedAt: now,
			})
			.where(($) => [$.id.in_(...connectionIds)]),
	)
	yield* db.run(
		SQLite.deleteFrom(schema.customerConnectionSecretsTable).where(($) => [
			$.connectionId.in_(...connectionIds),
		]),
	)
	yield* db.run(
		SQLite.update(schema.customerSyncRunsTable)
			.set({
				status: "failed",
				finishedAt: now,
				error: { code: "internal", message: "The connection was disconnected", httpStatus: null },
			})
			.where(($) => [$.connectionId.in_(...connectionIds), $.status.eq("running")]),
	)
})

/** The decrypted credentials of a connection; `None` once disconnected (no secrets). */
export const loadCredentials = Effect.fn("Customers.loadCredentials")(function* (
	connectionId: CustomerConnectionId,
	config: ConnectionConfig,
) {
	const db = yield* Database.Database
	const row = yield* db.first(
		SQLite.from(schema.customerConnectionSecretsTable)
			.select()
			.where(($) => [$.connectionId.eq(connectionId)])
			.limit(1),
	)
	if (Option.isNone(row)) return Option.none<ProviderCredentials>()
	const encryption = yield* IntegrationEncryption
	const secrets = row.value
	const apiKey = yield* encryption.decrypt({
		ciphertext: secrets.encryptedApiKey,
		iv: secrets.apiKeyIv,
		keyVersion: secrets.encryptionKeyVersion,
	})
	const webhookSecret =
		secrets.encryptedWebhookSecret === null || secrets.webhookSecretIv === null
			? null
			: yield* encryption.decrypt({
					ciphertext: secrets.encryptedWebhookSecret,
					iv: secrets.webhookSecretIv,
					keyVersion: secrets.encryptionKeyVersion,
				})
	return Option.some<ProviderCredentials>({
		apiKey: Redacted.make(apiKey),
		webhookSecret: webhookSecret === null ? null : Redacted.make(webhookSecret),
		config,
	})
})
