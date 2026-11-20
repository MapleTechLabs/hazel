/**
 * A connection's credentials (`customer_connection_secrets`): encrypted with
 * `IntegrationEncryption` on connect, decrypted only to call the provider. Never synced, never
 * returned by an RPC.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { CustomerConnectionId } from "@hazel/schema"
import { Clock, Effect, Option, Redacted } from "effect"
import { IntegrationEncryption } from "../../../services/integration-encryption"
import { HISTORY_DAYS } from "./compute"
import { CustomerIngest } from "./ingest"
import type { ProviderCredentials } from "./providers"
import { requestHistoryRebuild } from "./schedule"
import { addDays, dayOf } from "./time"

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

/**
 * Credentials of another provider account than the connection's (`after`). None recorded: another
 * once the connection imported something (whose account is unknown), else not.
 */
export const otherProviderAccount = (
	connection: Pick<
		schema.CustomerConnection,
		"externalAccountId" | "lastSuccessAt" | "backfilledAt"
	> | null,
	after: string,
) =>
	connection !== null &&
	(connection.externalAccountId === null
		? connection.lastSuccessAt !== null || connection.backfilledAt !== null
		: connection.externalAccountId !== after)

/**
 * New credentials open another provider account than the connection's: what the old account
 * brought is not this one's. Its records are swept, linked ones included (an account or contact no
 * other source holds is deleted, with the activity only it placed), its billing rows, events,
 * metrics and parked records go, and the connection imports from scratch (its next run a backfill).
 * When it is an account's MRR source (or none was computed yet), the last year of MRR history
 * (movements, the org's daily MRR) is rebuilt once that import is done; older history stays. The
 * caller starts that run.
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
	yield* db.run(
		SQLite.deleteFrom(schema.customerMetricDailyTable).where(($) => [
			SQLite.inSubquery(
				$.metricKey,
				SQLite.from(schema.customerMetricDefinitionsTable)
					.select("key")
					.where((d) => [d.provider.eq(provider)]),
			),
		]),
	)
	// Activity of the contacts only this provider placed (other sources' contacts keep theirs).
	yield* db.run(
		SQLite.deleteFrom(schema.customerActivityDailyTable).where(($) => [
			SQLite.inSubquery(
				$.contactId,
				SQLite.from(schema.customerExternalRefsTable, "r")
					.select("entityId")
					.where((r) => [
						r.provider.eq(provider),
						r.entityType.eq("contact"),
						SQLite.not(
							SQLite.exists(
								SQLite.from(schema.customerExternalRefsTable, "o")
									.select(() => ({ one: SQLite.lit(1) }))
									.where((o) => [
										o.entityType.eq("contact"),
										o.entityId.eq(r.entityId),
										o.provider.neq(provider),
										o.staleAt.isNull(),
									]),
							),
						),
					]),
			),
		]),
	)
	// Some account's MRR came from it, or none was computed yet: a rebuild's movements are its.
	const sources = new Set(
		(yield* db.run(
			SQLite.from(schema.customerAccountsTable)
				.where(($) => [$.mrrSource.isNotNull()])
				.select(($) => ({ mrrSource: $.mrrSource }))
				.distinct(),
		)).map((row) => row.mrrSource),
	)
	if ((provider === "stripe" || provider === "autumn") && (sources.size === 0 || sources.has(provider))) {
		const first = addDays(dayOf(now), -HISTORY_DAYS)
		yield* db.run(SQLite.deleteFrom(schema.customerMrrMovementsTable).where(($) => [$.day.gte(first)]))
		yield* db.run(
			SQLite.update(schema.customerOrgDailyTable)
				.set({ mrrMinor: 0, payingAccounts: 0, trialingAccounts: 0, atRiskMrrMinor: 0 })
				.where(($) => [$.day.gte(first)]),
		)
		yield* requestHistoryRebuild
	}
	yield* (yield* CustomerIngest).completeSweep(connection.id, now, ["account", "contact"], {
		manual: true,
	})
	const [row] = yield* db.run(
		SQLite.update(schema.customerConnectionsTable)
			.set({ backfilledAt: null, lastSuccessAt: null, updatedAt: now })
			.where(($) => [$.id.eq(connection.id)])
			.returning(),
	)
	return row
})
