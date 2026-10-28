/**
 * The one-shot Postgres import into an object (`POST /internal/import/:store/:id`,
 * `scripts/import-postgres.ts`): rows are written straight into the object's tables, bypassing
 * the handlers (the change triggers still record them). `finalize` on an `OrgObject` then
 * re-derives what other stores hold of it: each channel's access (`setViewers`, `channel_index`),
 * `membership_index` and `user_organizations`, `org_index`, and the webhook, integration and
 * chat sync indexes, all through the outbox.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { Effect, Option, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import {
	canonicalRow,
	type ImportResult as ImportResultType,
	ImportResult,
	ImportRow,
	ImportTableError,
	importTableOf,
	upsertStatement,
} from "../../lib/import-rows"
import { indexChatSync, publishChatSyncLinks } from "../../services/chat-sync/chat-sync-org"
import { defineCall } from "./calls"
import { DirectoryEffects } from "./effects/directory-effects"
import { enqueueEffect } from "./effects/registry"
import type { ObjectKind } from "./kinds"
import { publishMembership, syncChannelAccess } from "./org/channel-access"
import { indexInstallation, requireOrganizationId } from "./org/integrations"
import { reindexMessageSearch } from "./org/message-search"
import { publishOrgIndex } from "./org/organization"

const RowsPayload = Schema.Struct({ table: Schema.String, rows: Schema.Array(ImportRow) })

const rowsCall = <const K extends ObjectKind>(kind: K) =>
	defineCall(`${kind}.importRows`, kind, {
		payload: RowsPayload,
		success: ImportResult,
		error: ImportTableError,
	})

const finalizeCall = <const K extends ObjectKind>(kind: K) =>
	defineCall(`${kind}.importFinalize`, kind, {
		payload: Schema.Struct({}),
		success: ImportResult,
		error: Schema.Never,
	})

export const ImportCalls = {
	org: { rows: rowsCall("org"), finalize: finalizeCall("org") },
	channel: { rows: rowsCall("channel"), finalize: finalizeCall("channel") },
	user: { rows: rowsCall("user"), finalize: finalizeCall("user") },
} as const

/** Upsert one batch; a row its table rejects (or SQLite refuses) is logged and skipped. */
export const importRows = (kind: ObjectKind) =>
	Effect.fn(`Object.importRows`)(function* (payload: typeof RowsPayload.Type) {
		const table = importTableOf(kind, payload.table)
		if (Option.isNone(table)) {
			return yield* new ImportTableError({ store: kind, table: payload.table })
		}
		const sql = yield* SqlClient
		const db = yield* Database.Database
		const result = { applied: 0, skipped: 0 }
		yield* db
			.transaction(
				Effect.forEach(
					payload.rows,
					(row) =>
						canonicalRow(table.value, row).pipe(
							Effect.flatMap((canonical) => {
								const statement = upsertStatement(table.value, canonical)
								return sql.unsafe(statement.sql, statement.params)
							}),
							Effect.tap(() => Effect.sync(() => result.applied++)),
							Effect.catchTags({
								SchemaError: (error) => skip(result, payload.table, row, error.message),
								SqlError: (error) => skip(result, payload.table, row, error.message),
							}),
						),
					{ discard: true },
				),
			)
			.pipe(Effect.orDie)
		yield* Effect.annotateCurrentSpan({ "import.table": payload.table, ...prefixed(result) })
		return result as ImportResultType
	})

const skip = (result: { skipped: number }, table: string, row: ImportRow, message: string) =>
	Effect.logWarning("Import row skipped", { table, id: row.id ?? null, message }).pipe(
		Effect.tap(() => Effect.sync(() => result.skipped++)),
	)

const prefixed = (result: ImportResultType) => ({
	"import.applied": result.applied,
	"import.skipped": result.skipped,
})

/** Re-derive the org's projections and index rows from its imported tables. */
export const finalizeOrgImport = Effect.fn("OrgObject.importFinalize")(function* () {
	const organizationId = yield* requireOrganizationId
	const db = yield* Database.Database
	let published = 0
	yield* db
		.transaction(
			Effect.gen(function* () {
				yield* publishOrgIndex(organizationId)
				const channels = yield* db.run(SQLite.from(schema.channelsTable).select("id"))
				yield* Effect.forEach(channels, (channel) => syncChannelAccess(channel.id), { discard: true })
				published += channels.length

				const members = yield* db.run(
					SQLite.from(schema.organizationMembersTable)
						.select("userId")
						.where(($) => [$.organizationId.eq(organizationId), $.deletedAt.isNull()]),
				)
				yield* Effect.forEach(
					new Set(members.map((member) => member.userId)),
					(userId) => publishMembership(userId, organizationId),
					{ discard: true },
				)
				published += members.length

				const webhooks = yield* db.run(
					SQLite.from(schema.channelWebhooksTable)
						.select("id", "channelId", "organizationId", "tokenHash")
						.where(($) => [$.deletedAt.isNull()]),
				)
				yield* Effect.forEach(
					webhooks,
					(webhook) =>
						enqueueEffect(
							DirectoryEffects.upsertWebhookIndex,
							{ kind: "directory" },
							{
								webhookId: webhook.id,
								organizationId: webhook.organizationId,
								channelId: webhook.channelId,
								tokenHash: webhook.tokenHash,
							},
						),
					{ discard: true },
				)

				const connections = yield* db.run(
					SQLite.from(schema.integrationConnectionsTable)
						.select("provider", "metadata", "organizationId")
						.where(($) => [$.deletedAt.isNull(), $.status.eq("active")]),
				)
				yield* Effect.forEach(connections, (connection) => indexInstallation(connection, false), {
					discard: true,
				})

				const syncConnections = yield* db.run(
					SQLite.from(schema.chatSyncConnectionsTable)
						.select("id", "provider", "externalWorkspaceId", "organizationId")
						.where(($) => [$.deletedAt.isNull()]),
				)
				const links = yield* db.run(
					SQLite.from(schema.chatSyncChannelLinksTable)
						.select("syncConnectionId", "externalChannelId", "hazelChannelId")
						.where(($) => [$.deletedAt.isNull(), $.isActive.eq(true)]),
				)
				yield* Effect.forEach(
					syncConnections,
					(connection) =>
						Effect.gen(function* () {
							yield* indexChatSync(connection, { deleted: false })
							for (const link of links) {
								if (link.syncConnectionId !== connection.id) continue
								yield* indexChatSync(connection, { link, deleted: false })
							}
						}),
					{ discard: true },
				)
				yield* Effect.forEach(
					new Set(links.map((link) => link.hazelChannelId)),
					(channelId) => publishChatSyncLinks(channelId),
					{ discard: true },
				)
				// After each channel's `setViewers` (same outbox target, so delivered first).
				yield* reindexMessageSearch()
			}),
		)
		.pipe(Effect.orDie)
	yield* Effect.annotateCurrentSpan({ "import.published": published })
	return { applied: published, skipped: 0 } as ImportResultType
})

/** Channels and users hold nothing other stores derive from. */
export const finalizeNothing = () => Effect.succeed<ImportResultType>({ applied: 0, skipped: 0 })
