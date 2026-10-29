/**
 * Integration connections in the `OrgObject`: `integration_connections` and their encrypted
 * `integration_tokens` are the org's rows. The api Worker's routes (OAuth callback, API key
 * connect, status, disconnect, bot and resource token reads) reach them through these calls;
 * a GitHub App connection's installation id is indexed in the directory (`integration_index`),
 * which routes GitHub webhooks here (`./github-webhooks.ts`).
 */
import { IntegrationConnectionRepo } from "@hazel/backend-core"
import { Database, type DatabaseError } from "@hazel/db"
import { IntegrationNotConnectedError } from "@hazel/domain/http"
import { IntegrationConnection } from "@hazel/domain/models"
import { IntegrationConnectionId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { ChatSyncAttributionReconciler } from "../../../services/chat-sync/chat-sync-attribution-reconciler"
import { publishChatSyncAccounts } from "../../../services/chat-sync/chat-sync-org"
import { IntegrationTokenService } from "../../../services/integration-token-service"
import { IntegrationBotService } from "../../../services/integrations/integration-bot-service"
import { CurrentObject } from "../../../lib/current-object"
import { defineCall } from "../calls"
import { DirectoryEffects } from "../effects/directory-effects"
import { enqueueEffect } from "../effects/registry"

/** The organization of the `OrgObject` a call runs in. */
export const requireOrganizationId = Effect.gen(function* () {
	const object = yield* CurrentObject
	return OrganizationId.make(object.id)
})

const Provider = IntegrationConnection.IntegrationProvider
type Provider = IntegrationConnection.IntegrationProvider
type Connection = IntegrationConnection.Type

/** Providers whose user-level link re-attributes synced messages (chat-sync). */
const ATTRIBUTION_PROVIDERS = new Set<Provider>(["discord"])

/** The token exists but could not be produced (refresh, decryption or storage failed). */
export class IntegrationTokenUnavailableError extends Schema.TaggedError<IntegrationTokenUnavailableError>()(
	"IntegrationTokenUnavailableError",
	{ provider: Provider, message: Schema.String },
) {}

/** Saving a connection failed; `stage` names the step (the OAuth callback's error code). */
export class IntegrationConnectFailedError extends Schema.TaggedError<IntegrationConnectFailedError>()(
	"IntegrationConnectFailedError",
	{ stage: Schema.Literals(["db_error", "encryption_error"]), message: Schema.String },
) {}

const Level = Schema.Struct({
	provider: Provider,
	/** The linked user for a user-level connection; null for the org's own. */
	userId: Schema.NullOr(UserId),
})

export const IntegrationConnectionCall = defineCall("org.integrationConnection", "org", {
	payload: Level,
	success: Schema.NullOr(IntegrationConnection.Schema),
	error: Schema.Never,
})

export const IntegrationAccessTokenCall = defineCall("org.integrationAccessToken", "org", {
	payload: Schema.Struct({ provider: Provider }),
	/** Null when the org has no active connection (or no token) for the provider. */
	success: Schema.NullOr(
		Schema.Struct({ accessToken: Schema.String, connection: IntegrationConnection.Schema }),
	),
	error: IntegrationTokenUnavailableError,
})

export const ActiveIntegrationsCall = defineCall("org.activeIntegrations", "org", {
	payload: Schema.Struct({}),
	success: Schema.Array(Provider),
	error: Schema.Never,
})

export const ConnectIntegrationCall = defineCall("org.connectIntegration", "org", {
	payload: Schema.Struct({
		...Level.fields,
		connectedBy: UserId,
		externalAccountId: Schema.NullOr(Schema.String),
		externalAccountName: Schema.NullOr(Schema.String),
		settings: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
		metadata: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
		tokens: Schema.Struct({
			accessToken: Schema.String,
			refreshToken: Schema.NullOr(Schema.String),
			expiresAt: Schema.NullOr(Schema.Date),
			scope: Schema.NullOr(Schema.String),
		}),
	}),
	success: Schema.Struct({ connectionId: IntegrationConnectionId, botInstalled: Schema.Boolean }),
	error: IntegrationConnectFailedError,
})

export const DisconnectIntegrationCall = defineCall("org.disconnectIntegration", "org", {
	payload: Level,
	success: IntegrationConnection.Schema,
	error: IntegrationNotConnectedError,
})

const findConnection = (organizationId: OrganizationId, level: typeof Level.Type) =>
	Effect.flatMap(IntegrationConnectionRepo, (repo) =>
		level.userId === null
			? repo.findOrgConnection(organizationId, level.provider)
			: repo.findUserConnection(organizationId, level.userId, level.provider),
	)

/** The GitHub App installation a connection names (`metadata.installationId`). */
const installationIdOf = (connection: Pick<Connection, "provider" | "metadata">) => {
	const value = connection.provider === "github" ? connection.metadata?.installationId : undefined
	return typeof value === "string" || typeof value === "number" ? String(value) : undefined
}

/** Index (or unindex) a GitHub installation in the directory, after the commit. */
export const indexInstallation = (
	connection: Pick<Connection, "provider" | "metadata" | "organizationId">,
	remove: boolean,
): Effect.Effect<void, DatabaseError | Schema.SchemaError, SqlClient> => {
	const externalId = installationIdOf(connection)
	return externalId === undefined
		? Effect.void
		: enqueueEffect(
				DirectoryEffects.upsertIntegrationIndex,
				{ kind: "directory" },
				{ provider: "github", externalId, organizationId: connection.organizationId, remove },
			).pipe(Effect.asVoid)
}

export const integrationConnection = Effect.fn("OrgObject.integrationConnection")(function* (
	payload: typeof Level.Type,
) {
	const organizationId = yield* requireOrganizationId
	return Option.getOrNull(yield* findConnection(organizationId, payload).pipe(Effect.orDie))
})

export const integrationAccessToken = Effect.fn("OrgObject.integrationAccessToken")(function* (payload: {
	readonly provider: Provider
}) {
	const organizationId = yield* requireOrganizationId
	const tokens = yield* IntegrationTokenService
	const connection = yield* findConnection(organizationId, {
		provider: payload.provider,
		userId: null,
	}).pipe(Effect.orDie)
	if (Option.isNone(connection) || connection.value.status !== "active") return null
	const unavailable = (message: string) =>
		Effect.fail(new IntegrationTokenUnavailableError({ provider: payload.provider, message }))
	return yield* tokens.getValidAccessToken(connection.value.id).pipe(
		Effect.map((accessToken) => ({ accessToken, connection: connection.value })),
		Effect.catchTags({
			TokenNotFoundError: () => Effect.succeed(null),
			ConnectionNotFoundError: () => Effect.succeed(null),
			TokenRefreshError: () => unavailable(`Failed to refresh ${payload.provider} token`),
			IntegrationEncryptionError: () => unavailable(`Failed to decrypt ${payload.provider} token`),
			KeyVersionNotFoundError: () => unavailable(`Encryption key version not found`),
			DatabaseError: () => unavailable("Database error while reading the token"),
		}),
	)
})

export const activeIntegrations = Effect.fn("OrgObject.activeIntegrations")(function* () {
	const organizationId = yield* requireOrganizationId
	const repo = yield* IntegrationConnectionRepo
	const rows = yield* repo.findActiveOrgConnections(organizationId).pipe(Effect.orDie)
	return [...new Set(rows.map((row) => row.provider))]
})

export const connectIntegration = Effect.fn("OrgObject.connectIntegration")(
	function* (payload: typeof ConnectIntegrationCall.payload.Type) {
		const organizationId = yield* requireOrganizationId
		const db = yield* Database.Database
		const repo = yield* IntegrationConnectionRepo
		const tokens = yield* IntegrationTokenService
		const insert = {
			provider: payload.provider,
			organizationId,
			userId: payload.userId,
			level: payload.userId === null ? "organization" : "user",
			status: "active",
			externalAccountId: payload.externalAccountId,
			externalAccountName: payload.externalAccountName,
			connectedBy: payload.connectedBy,
			settings: payload.settings,
			metadata: payload.metadata,
			errorMessage: null,
			lastUsedAt: null,
			deletedAt: null,
		} as const
		const failed =
			(stage: IntegrationConnectFailedError["stage"]) => (error: { readonly message?: string }) =>
				Effect.fail(new IntegrationConnectFailedError({ stage, message: error.message ?? stage }))

		const connection = yield* db.transaction(
			Effect.gen(function* () {
				const saved = yield* (
					payload.userId === null
						? repo.upsertByOrgAndProvider(insert)
						: repo.upsertByUserAndProvider(insert)
				).pipe(
					Effect.catchTags({ DatabaseError: failed("db_error"), SchemaError: failed("db_error") }),
				)
				yield* tokens
					.storeTokens(saved.id, {
						accessToken: payload.tokens.accessToken,
						...(payload.tokens.refreshToken === null
							? {}
							: { refreshToken: payload.tokens.refreshToken }),
						...(payload.tokens.expiresAt === null ? {} : { expiresAt: payload.tokens.expiresAt }),
						...(payload.tokens.scope === null ? {} : { scope: payload.tokens.scope }),
					})
					.pipe(
						Effect.catchTags({
							IntegrationEncryptionError: failed("encryption_error"),
							DatabaseError: failed("db_error"),
							SchemaError: failed("db_error"),
						}),
					)
				yield* indexInstallation(saved, false).pipe(
					Effect.catchTags({ DatabaseError: failed("db_error"), SchemaError: failed("db_error") }),
				)
				// A user's provider account: re-project the linked channels (mentions resolve to it).
				if (payload.userId !== null && ATTRIBUTION_PROVIDERS.has(payload.provider)) {
					yield* publishChatSyncAccounts(payload.provider).pipe(
						Effect.catchTags({
							DatabaseError: failed("db_error"),
							SchemaError: failed("db_error"),
						}),
					)
				}
				return saved
			}),
		)

		// Best effort after the connection is saved: neither may fail the connect.
		if (
			payload.userId !== null &&
			ATTRIBUTION_PROVIDERS.has(payload.provider) &&
			payload.externalAccountId !== null &&
			payload.externalAccountId.length > 0
		) {
			const reconciler = yield* ChatSyncAttributionReconciler
			const userId = payload.userId
			const externalAccountId = payload.externalAccountId
			yield* db
				.transaction(
					reconciler.relinkHistoricalProviderMessages({
						organizationId,
						provider: payload.provider,
						userId,
						externalAccountId,
						externalAccountName: payload.externalAccountName,
					}),
				)
				.pipe(
					Effect.catchCause((cause) =>
						Effect.logWarning(
							"Failed to re-attribute historical external messages after account link",
							{
								event: "chat_sync_attribution_relink_failed",
								provider: payload.provider,
								cause,
							},
						),
					),
				)
		}

		let botInstalled = false
		if (payload.userId === null) {
			const bots = yield* IntegrationBotService
			botInstalled = yield* db.transaction(bots.addBotToOrg(payload.provider, organizationId)).pipe(
				Effect.map(Option.isSome),
				Effect.catchCause((cause) =>
					Effect.logWarning("Failed to add integration bot to org (non-critical)", {
						event: "integration_bot_add_failed",
						provider: payload.provider,
						cause,
					}).pipe(Effect.as(false)),
				),
			)
		}
		yield* Effect.annotateCurrentSpan({
			"integration.provider": payload.provider,
			"bot.installed": botInstalled,
		})
		return { connectionId: connection.id, botInstalled }
	},
	Effect.catchTag("DatabaseError", Effect.die),
)

export const disconnectIntegration = Effect.fn("OrgObject.disconnectIntegration")(function* (
	payload: typeof Level.Type,
) {
	const organizationId = yield* requireOrganizationId
	const db = yield* Database.Database
	const repo = yield* IntegrationConnectionRepo
	const tokens = yield* IntegrationTokenService
	const found = yield* findConnection(organizationId, payload).pipe(Effect.orDie)
	if (Option.isNone(found)) {
		return yield* new IntegrationNotConnectedError({ provider: payload.provider })
	}
	const connection = found.value
	const externalAccountId = connection.externalAccountId

	if (
		payload.userId !== null &&
		ATTRIBUTION_PROVIDERS.has(payload.provider) &&
		typeof externalAccountId === "string" &&
		externalAccountId.length > 0
	) {
		const reconciler = yield* ChatSyncAttributionReconciler
		const userId = payload.userId
		yield* db
			.transaction(
				reconciler.unlinkHistoricalProviderMessages({
					organizationId,
					provider: payload.provider,
					userId,
					externalAccountId,
					externalAccountName: connection.externalAccountName,
				}),
			)
			.pipe(
				Effect.catchCause((cause) =>
					Effect.logWarning(
						"Failed to re-attribute historical external messages after account unlink",
						{
							event: "chat_sync_attribution_unlink_failed",
							provider: payload.provider,
							cause,
						},
					),
				),
			)
	}

	yield* db
		.transaction(
			Effect.gen(function* () {
				yield* tokens.deleteTokens(connection.id)
				yield* repo.softDelete(connection.id)
				yield* indexInstallation(connection, true)
				if (payload.userId !== null && ATTRIBUTION_PROVIDERS.has(payload.provider)) {
					yield* publishChatSyncAccounts(payload.provider)
				}
			}),
		)
		.pipe(Effect.orDie)
	yield* Effect.logInfo("AUDIT: Integration disconnected", {
		event: "integration_disconnected",
		provider: payload.provider,
		organizationId,
		userId: payload.userId,
		connectionId: connection.id,
	})
	return connection
})
