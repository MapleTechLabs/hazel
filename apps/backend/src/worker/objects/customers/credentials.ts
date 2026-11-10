/**
 * A connection's credentials (`customer_connection_secrets`): encrypted with
 * `IntegrationEncryption` on connect, decrypted only to call the provider. Never synced, never
 * returned by an RPC.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { CustomerConnectionId } from "@hazel/schema"
import { Clock, Effect, Option, Redacted } from "effect"
import { IntegrationEncryption } from "../../../services/integration-encryption"
import { CustomerIngest } from "./ingest"
import type { ProviderCredentials } from "./providers"
import { requestHistoryRebuild } from "./schedule"

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
	connection: Pick<schema.CustomerConnection, "id" | "config" | "externalAccountId">,
) {
	const db = yield* Database.Database
	const row = yield* db.first(
		SQLite.from(schema.customerConnectionSecretsTable)
			.select()
			.where(($) => [$.connectionId.eq(connection.id)])
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
		config: connection.config,
		externalAccountId: connection.externalAccountId,
	})
})

/** Credentials of another provider account than the connection's (none recorded: not another). */
export const otherProviderAccount = (before: string | null, after: string) =>
	before !== null && before !== after

/**
 * New credentials open another provider account than the connection's: what the old account
 * brought is not this one's. Its records are swept, linked ones included (an account or contact no
 * other source holds is deleted, with the activity only it placed), its billing rows, events,
 * metrics and parked records go, and the connection imports from scratch (its next run a backfill).
 * A billing source's MRR history (movements, the org's daily MRR) is rebuilt once that import is
 * done. The caller starts that run.
 */
export const switchProviderAccount = Effect.fn("Customers.switchProviderAccount")(function* (
	connection: schema.CustomerConnection,
	now: Date,
) {
	const db = yield* Database.Database
	const { provider } = connection
	yield* db.run(
		SQLite.deleteFrom(schema.customerSubscriptionsTable).where(($) => [$.provider.eq(provider)]),
	)
	yield* db.run(SQLite.deleteFrom(schema.customerInvoicesTable).where(($) => [$.provider.eq(provider)]))
	yield* db.run(SQLite.deleteFrom(schema.customerEventsTable).where(($) => [$.provider.eq(provider)]))
	yield* db.run(
		SQLite.deleteFrom(schema.customerUnmatchedRecordsTable).where(($) => [
			$.provider.eq(provider),
			$.status.eq("open"),
		]),
	)
	yield* db.query(
		Database.sql`DELETE FROM "customer_metric_daily" WHERE "metricKey" IN
			(SELECT "key" FROM "customer_metric_definitions" WHERE "provider" = ${provider})`,
	)
	// Activity of the contacts only this provider placed (other sources' contacts keep theirs).
	yield* db.query(
		Database.sql`DELETE FROM "customer_activity_daily" WHERE "contactId" IN (
			SELECT "entityId" FROM "customer_external_refs" AS "r"
			WHERE "provider" = ${provider} AND "entityType" = 'contact' AND NOT EXISTS (
				SELECT 1 FROM "customer_external_refs" AS "o" WHERE "o"."entityType" = 'contact'
					AND "o"."entityId" = "r"."entityId" AND "o"."provider" <> ${provider} AND "o"."staleAt" IS NULL))`,
	)
	if (provider === "stripe" || provider === "autumn") {
		yield* db.run(SQLite.deleteFrom(schema.customerMrrMovementsTable).allRows())
		yield* db.run(
			SQLite.update(schema.customerOrgDailyTable)
				.set({ mrrMinor: 0, payingAccounts: 0, trialingAccounts: 0, atRiskMrrMinor: 0 })
				.allRows(),
		)
		yield* requestHistoryRebuild
	}
	yield* (yield* CustomerIngest).completeSweep(connection.id, now, ["account", "contact"], true)
	const [row] = yield* db.run(
		SQLite.update(schema.customerConnectionsTable)
			.set({ backfilledAt: null, lastSuccessAt: null, updatedAt: now })
			.where(($) => [$.id.eq(connection.id)])
			.returning(),
	)
	return row
})
