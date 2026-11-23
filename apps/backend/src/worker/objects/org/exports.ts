/**
 * Organization data exports, built by the `OrgObject` on its alarm (`docs/self-hosting.md`, "Data
 * export"). An owner or admin starts one (`organizationExport.start`); while one is pending or
 * running the object's alarm is due (`exportDeadlines`), and each alarm runs one bounded step
 * (`OrgExportTickCall`):
 *
 * 1. The org's own tables (`ORG_SECTIONS`), in pages by id, each with an explicit column list:
 *    secrets (integration tokens, webhook token hashes, auth data, bot tokens) are never read.
 * 2. Every channel the org owns, threads included (Connect guest mounts are the host's), table by
 *    table, through `channel.exportPage` on its `ChannelObject`.
 *
 * A step reads pages until its time budget or part size is reached, writes them as one NDJSON part
 * to the exports bucket (`OrgExports`), then saves its cursor: a step cut short re-reads only what
 * it had not saved. A failing step is retried with a backoff and fails the export after
 * `MAX_ATTEMPTS`. The first line is a header, the last an `end` line with the row count.
 */
import { Database, type DatabaseError, SQLite, schema } from "@hazel/db"
import {
	ChannelId,
	ChannelMemberId,
	ChannelSectionId,
	ChannelWebhookId,
	CustomEmojiId,
	IntegrationConnectionId,
	type OrganizationExportId,
	OrganizationMemberId,
	type OrganizationId,
	UserId,
} from "@hazel/schema"
import { Cause, Clock, Effect, Exit, Option, Schema } from "effect"
import { OrgExports, ORG_EXPORT_RETENTION_DAYS } from "../../../services/org-exports"
import { callObject, defineCall } from "../calls"
import { CHANNEL_EXPORT_TABLES, ChannelExportPageCall } from "../channel/export-page"
import { channelTarget } from "../kinds"
import { requireOrganizationId } from "./integrations"

export const EXPORT_FORMAT = "hazel.organization-export"
export const EXPORT_FORMAT_VERSION = 1

/** Sizes of a step; mutable so tests can exercise paging with a handful of rows. */
export const exportTuning = {
	/** Rows per page of an org table. */
	orgPage: 1000,
	/** Rows per `channel.exportPage` call. */
	channelPage: 500,
	/** A part is written once it holds this many bytes. */
	partBytes: 4 * 1024 * 1024,
	/** A step stops reading after this long. */
	stepMs: 10_000,
}

const MAX_ATTEMPTS = 5
const RETRY_BASE_MS = 30_000

const Cursor = Schema.Struct({
	phase: Schema.Literals(["org", "channels", "done"]),
	/** The org section, or the channel table, being read. */
	section: Schema.Finite,
	/** The last id written of that section. */
	after: Schema.NullOr(Schema.String),
	/** The channel being read; `null` between channels. */
	channelId: Schema.NullOr(Schema.String),
	/** The last channel finished (channels go by id). */
	lastChannelId: Schema.NullOr(Schema.String),
	/** Consecutive failed steps, and when to try again. */
	attempts: Schema.Finite,
	retryAt: Schema.NullOr(Schema.Finite),
})
type Cursor = typeof Cursor.Type

const CursorJson = Schema.fromJsonString(Cursor)
const decodeCursor = Schema.decodeUnknownOption(CursorJson)
const encodeCursor = (cursor: Cursor) => JSON.stringify(cursor)

const initialCursor: Cursor = {
	phase: "org",
	section: 0,
	after: null,
	channelId: null,
	lastChannelId: null,
	attempts: 0,
	retryAt: null,
}

type Row = Readonly<Record<string, unknown>>

/** Dates as ISO strings. */
const toJson = (row: { readonly id: string }): Row => JSON.parse(JSON.stringify(row))

interface OrgSection {
	readonly table: string
	readonly read: (
		organizationId: OrganizationId,
		after: string | null,
		limit: number,
	) => Effect.Effect<ReadonlyArray<{ readonly id: string }>, DatabaseError, Database.Database>
}

const section = (table: string, read: OrgSection["read"]): OrgSection => ({ table, read })

/** The org's tables, each with the columns an export may carry. */
const ORG_SECTIONS: ReadonlyArray<OrgSection> = [
	section("organizations", (organizationId, after, limit) =>
		Effect.flatMap(Database.Database, (db) =>
			db.run(
				SQLite.from(schema.organizationsTable)
					.select("id", "name", "slug", "logoUrl", "isPublic", "createdAt", "updatedAt")
					.where(($) => [
						$.id.eq(organizationId),
						after === null ? undefined : $.id.gt(organizationId),
					])
					.limit(limit),
			),
		),
	),
	section("organization_members", (organizationId, after, limit) =>
		Effect.flatMap(Database.Database, (db) =>
			db.run(
				SQLite.from(schema.organizationMembersTable)
					.select(
						"id",
						"organizationId",
						"userId",
						"role",
						"nickname",
						"joinedAt",
						"invitedBy",
						"createdAt",
					)
					.where(($) => [
						$.organizationId.eq(organizationId),
						$.deletedAt.isNull(),
						after === null ? undefined : $.id.gt(OrganizationMemberId.make(after)),
					])
					.orderBy(($) => [[$.id, "asc"]])
					.limit(limit),
			),
		),
	),
	// The members' public profiles: no email, external id, settings or auth state.
	section("users", (organizationId, after, limit) =>
		Effect.flatMap(Database.Database, (db) =>
			db.run(
				SQLite.from(schema.usersTable)
					.select("id", "firstName", "lastName", "avatarUrl", "userType", "timezone", "createdAt")
					.where(($) => [
						SQLite.inSubquery(
							$.id,
							SQLite.from(schema.organizationMembersTable)
								.select("userId")
								.where((m) => [m.organizationId.eq(organizationId), m.deletedAt.isNull()]),
						),
						after === null ? undefined : $.id.gt(UserId.make(after)),
					])
					.orderBy(($) => [[$.id, "asc"]])
					.limit(limit),
			),
		),
	),
	section("channel_sections", (organizationId, after, limit) =>
		Effect.flatMap(Database.Database, (db) =>
			db.run(
				SQLite.from(schema.channelSectionsTable)
					.select("id", "organizationId", "name", "order", "createdAt", "updatedAt")
					.where(($) => [
						$.organizationId.eq(organizationId),
						$.deletedAt.isNull(),
						after === null ? undefined : $.id.gt(ChannelSectionId.make(after)),
					])
					.orderBy(($) => [[$.id, "asc"]])
					.limit(limit),
			),
		),
	),
	section("channels", (organizationId, after, limit) =>
		Effect.flatMap(Database.Database, (db) =>
			db.run(
				SQLite.from(schema.channelsTable)
					.select(
						"id",
						"name",
						"icon",
						"type",
						"organizationId",
						"parentChannelId",
						"sectionId",
						"createdAt",
						"updatedAt",
					)
					.where(($) => [
						$.organizationId.eq(organizationId),
						$.deletedAt.isNull(),
						after === null ? undefined : $.id.gt(ChannelId.make(after)),
					])
					.orderBy(($) => [[$.id, "asc"]])
					.limit(limit),
			),
		),
	),
	section("channel_members", (organizationId, after, limit) =>
		Effect.flatMap(Database.Database, (db) =>
			db.run(
				SQLite.from(schema.channelMembersTable)
					.select("id", "channelId", "userId", "joinedAt", "createdAt")
					.where(($) => [
						$.deletedAt.isNull(),
						SQLite.inSubquery(
							$.channelId,
							SQLite.from(schema.channelsTable)
								.select("id")
								.where((c) => [c.organizationId.eq(organizationId)]),
						),
						after === null ? undefined : $.id.gt(ChannelMemberId.make(after)),
					])
					.orderBy(($) => [[$.id, "asc"]])
					.limit(limit),
			),
		),
	),
	section("custom_emojis", (organizationId, after, limit) =>
		Effect.flatMap(Database.Database, (db) =>
			db.run(
				SQLite.from(schema.customEmojisTable)
					.select("id", "organizationId", "name", "imageUrl", "createdBy", "createdAt")
					.where(($) => [
						$.organizationId.eq(organizationId),
						$.deletedAt.isNull(),
						after === null ? undefined : $.id.gt(CustomEmojiId.make(after)),
					])
					.orderBy(($) => [[$.id, "asc"]])
					.limit(limit),
			),
		),
	),
	// Which integrations are connected; never their tokens (`integration_tokens`), settings or metadata.
	section("integration_connections", (organizationId, after, limit) =>
		Effect.flatMap(Database.Database, (db) =>
			db.run(
				SQLite.from(schema.integrationConnectionsTable)
					.select(
						"id",
						"provider",
						"organizationId",
						"userId",
						"level",
						"status",
						"externalAccountName",
						"connectedBy",
						"lastUsedAt",
						"createdAt",
						"updatedAt",
					)
					.where(($) => [
						$.organizationId.eq(organizationId),
						$.deletedAt.isNull(),
						after === null ? undefined : $.id.gt(IntegrationConnectionId.make(after)),
					])
					.orderBy(($) => [[$.id, "asc"]])
					.limit(limit),
			),
		),
	),
	// Incoming webhooks without their token (`tokenHash`, `tokenSuffix`).
	section("channel_webhooks", (organizationId, after, limit) =>
		Effect.flatMap(Database.Database, (db) =>
			db.run(
				SQLite.from(schema.channelWebhooksTable)
					.select(
						"id",
						"channelId",
						"organizationId",
						"botUserId",
						"name",
						"description",
						"avatarUrl",
						"isEnabled",
						"createdBy",
						"lastUsedAt",
						"createdAt",
						"updatedAt",
					)
					.where(($) => [
						$.organizationId.eq(organizationId),
						$.deletedAt.isNull(),
						after === null ? undefined : $.id.gt(ChannelWebhookId.make(after)),
					])
					.orderBy(($) => [[$.id, "asc"]])
					.limit(limit),
			),
		),
	),
]

/** Channels whose messages live elsewhere: this org's Connect guest mounts (the host's channel holds them). */
const guestMounts = (organizationId: OrganizationId) =>
	SQLite.from(schema.connectConversationChannelsTable)
		.select("channelId")
		.where(($) => [$.organizationId.eq(organizationId), $.role.eq("guest"), $.deletedAt.isNull()])

/** The channels whose rows the export reads: the org's own, threads included. */
const exportedChannels = (organizationId: OrganizationId) =>
	SQLite.from(schema.channelsTable).where(($) => [
		$.organizationId.eq(organizationId),
		$.deletedAt.isNull(),
		SQLite.notInSubquery($.id, guestMounts(organizationId)),
	])

const countChannels = (organizationId: OrganizationId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.channelsTable)
				.select(() => ({ count: SQLite.count() }))
				.where(($) => [
					$.organizationId.eq(organizationId),
					$.deletedAt.isNull(),
					SQLite.notInSubquery($.id, guestMounts(organizationId)),
				]),
		),
	).pipe(Effect.map((row) => Number(Option.getOrUndefined(row)?.count ?? 0)))

const nextChannel = (organizationId: OrganizationId, after: string | null) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			exportedChannels(organizationId)
				.select("id")
				.where(($) => [after === null ? undefined : $.id.gt(ChannelId.make(after))])
				.orderBy(($) => [[$.id, "asc"]])
				.limit(1),
		),
	).pipe(Effect.map((row) => Option.getOrNull(Option.map(row, (channel) => channel.id as string))))

const line = (table: string, row: Row) => `${JSON.stringify({ table, row })}\n`

interface Page {
	readonly lines: ReadonlyArray<string>
	readonly rows: number
	readonly cursor: Cursor
	/** A channel was finished. */
	readonly channelDone: boolean
}

/** Read the next page after `cursor`. */
const readNext = (organizationId: OrganizationId, cursor: Cursor) =>
	Effect.gen(function* () {
		const exports = yield* OrgExports
		if (cursor.phase === "org") {
			const current = ORG_SECTIONS[cursor.section]
			if (current === undefined) {
				return {
					lines: [],
					rows: 0,
					cursor: { ...cursor, phase: "channels", section: 0, after: null },
					channelDone: false,
				} satisfies Page
			}
			const limit = exportTuning.orgPage
			const read = yield* current.read(organizationId, cursor.after, limit)
			const rows = read.map(toJson)
			const last = read[read.length - 1]
			const finished = rows.length < limit || last === undefined
			return {
				lines: rows.map((row) => line(current.table, row)),
				rows: rows.length,
				cursor: finished
					? { ...cursor, section: cursor.section + 1, after: null }
					: { ...cursor, after: last.id },
				channelDone: false,
			} satisfies Page
		}
		if (cursor.phase === "done") return { lines: [], rows: 0, cursor, channelDone: false } satisfies Page

		const channelId = cursor.channelId ?? (yield* nextChannel(organizationId, cursor.lastChannelId))
		if (channelId === null) {
			return {
				lines: [],
				rows: 0,
				cursor: { ...cursor, phase: "done" },
				channelDone: false,
			} satisfies Page
		}
		const table = CHANNEL_EXPORT_TABLES[cursor.section]
		if (table === undefined) {
			return {
				lines: [],
				rows: 0,
				cursor: { ...cursor, section: 0, after: null, channelId: null, lastChannelId: channelId },
				channelDone: true,
			} satisfies Page
		}
		const page = yield* callObject(ChannelExportPageCall, channelTarget(channelId), {
			table,
			after: cursor.after,
			limit: exportTuning.channelPage,
		})
		const lines = page.rows.map((row) =>
			line(
				table,
				table === "attachments"
					? {
							...row,
							publicUrl:
								typeof row.externalUrl === "string"
									? row.externalUrl
									: exports.attachmentUrl(String(row.id)),
						}
					: row,
			),
		)
		return {
			lines,
			rows: page.rows.length,
			cursor:
				page.next === null
					? { ...cursor, channelId, section: cursor.section + 1, after: null }
					: { ...cursor, channelId, after: page.next },
			channelDone: false,
		} satisfies Page
	})

const exportsTable = schema.organizationExportsTable

/** The export the alarm works on: the oldest pending or running one. */
const activeExport = Effect.flatMap(Database.Database, (db) =>
	db.first(
		SQLite.from(exportsTable)
			.select()
			.where(($) => [SQLite.or($.status.eq("pending"), $.status.eq("running"))])
			.orderBy(($) => [[$.createdAt, "asc"]])
			.limit(1),
	),
)

/** When the alarm should run the next step (now, or a failed step's retry time). */
export const exportDeadlines = activeExport.pipe(
	Effect.map(
		Option.match({
			onNone: () => [],
			onSome: (row) => [
				Option.getOrUndefined(
					Option.flatMap(decodeCursor(row.cursor), (c) => Option.fromNullishOr(c.retryAt)),
				) ?? 0,
			],
		}),
	),
	Effect.catchTag("DatabaseError", (error) =>
		Effect.logWarning("Export deadline lookup failed", { error: error.message }).pipe(Effect.as([])),
	),
)

/** Run one step of the active export; `stepped` when there was one. */
export const OrgExportTickCall = defineCall("org.exportTick", "org", {
	payload: Schema.Struct({}),
	success: Schema.Struct({ stepped: Schema.Boolean }),
	error: Schema.Never,
})

export const exportTick = Effect.fn("OrgObject.exportTick")(
	function* () {
		const organizationId = yield* requireOrganizationId
		const db = yield* Database.Database
		const exports = yield* OrgExports
		const found = yield* activeExport
		if (Option.isNone(found)) return { stepped: false }
		const row = found.value
		const now = yield* Clock.currentTimeMillis
		const saved = Option.getOrElse(decodeCursor(row.cursor), () => initialCursor)
		if (saved.retryAt !== null && saved.retryAt > now) return { stepped: false }

		let channelCount = row.channelCount
		if (row.status === "pending") {
			channelCount = yield* countChannels(organizationId)
			yield* db.run(
				SQLite.update(exportsTable)
					.set({
						status: "running",
						channelCount,
						cursor: encodeCursor(initialCursor),
						updatedAt: new Date(),
					})
					.where(($) => [$.id.eq(row.id)]),
			)
		}

		const step = Effect.gen(function* () {
			const deadline = now + exportTuning.stepMs
			const lines: Array<string> = []
			if (row.partCount === 0 && saved.phase === "org" && saved.section === 0 && saved.after === null) {
				lines.push(
					`${JSON.stringify({
						table: "export",
						row: {
							format: EXPORT_FORMAT,
							version: EXPORT_FORMAT_VERSION,
							exportId: row.id,
							organizationId,
							requestedBy: row.requestedBy,
							createdAt: row.createdAt.toISOString(),
						},
					})}\n`,
				)
			}
			let bytes = 0
			let rows = 0
			let channelsDone = 0
			let cursor: Cursor = { ...saved, attempts: 0, retryAt: null }
			while (cursor.phase !== "done") {
				const page: Page = yield* readNext(organizationId, cursor)
				for (const each of page.lines) {
					lines.push(each)
					bytes += each.length
				}
				rows += page.rows
				if (page.channelDone) channelsDone += 1
				cursor = page.cursor
				if (bytes >= exportTuning.partBytes || (yield* Clock.currentTimeMillis) >= deadline) break
			}
			const done = cursor.phase === "done"
			if (done) {
				lines.push(
					`${JSON.stringify({ table: "end", row: { exportId: row.id, rowCount: row.rowCount + rows } })}\n`,
				)
			}
			const body = lines.join("")
			const wrote = body.length > 0
			if (wrote) yield* exports.putPart(organizationId, row.id, row.partCount, body)
			return {
				cursor,
				done,
				rows,
				channelsDone,
				bytes: wrote ? new TextEncoder().encode(body).length : 0,
				wrote,
			}
		})

		const exit = yield* Effect.exit(step)
		const updatedAt = new Date()
		if (Exit.isSuccess(exit)) {
			const result = exit.value
			const completedAt = result.done ? updatedAt : null
			yield* db.run(
				SQLite.update(exportsTable)
					.set({
						cursor: encodeCursor(result.cursor),
						status: result.done ? "ready" : "running",
						partCount: row.partCount + (result.wrote ? 1 : 0),
						rowCount: row.rowCount + result.rows,
						byteSize: row.byteSize + result.bytes,
						channelsDone: Math.min(channelCount, row.channelsDone + result.channelsDone),
						error: null,
						updatedAt,
						completedAt,
						expiresAt:
							completedAt === null
								? null
								: new Date(completedAt.getTime() + ORG_EXPORT_RETENTION_DAYS * 86_400_000),
					})
					.where(($) => [$.id.eq(row.id)]),
			)
			return { stepped: true }
		}
		// Interrupted (the instance is going away): the next alarm resumes from the saved cursor.
		if (Exit.hasInterrupts(exit)) return yield* Effect.interrupt
		const attempts = saved.attempts + 1
		const failed = attempts >= MAX_ATTEMPTS
		const message = Cause.pretty(exit.cause).slice(0, 1000)
		yield* Effect.logWarning("Organization export step failed", {
			exportId: row.id,
			attempts,
			error: message,
		})
		yield* db.run(
			SQLite.update(exportsTable)
				.set({
					cursor: encodeCursor({ ...saved, attempts, retryAt: now + RETRY_BASE_MS * attempts }),
					status: failed ? "failed" : "running",
					error: failed ? "The export could not be completed. Try again." : null,
					updatedAt,
				})
				.where(($) => [$.id.eq(row.id)]),
		)
		return { stepped: true }
	},
	Effect.catchTag("DatabaseError", (error) => Effect.die(error)),
)

/** The row as clients see it (`@hazel/domain/models` `OrganizationExport`), without the cursor. */
export const toExportModel = ({ cursor: _cursor, ...row }: schema.OrganizationExport) => row

/** An active owner or admin of this org. */
export const isOrganizationAdmin = (organizationId: OrganizationId, userId: UserId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.organizationMembersTable)
				.select("role")
				.where(($) => [
					$.organizationId.eq(organizationId),
					$.userId.eq(userId),
					$.deletedAt.isNull(),
				])
				.limit(1),
		),
	).pipe(
		Effect.map(
			Option.match({ onNone: () => false, onSome: (m) => m.role === "owner" || m.role === "admin" }),
		),
	)

export const findExport = (id: OrganizationExportId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(exportsTable)
				.select()
				.where(($) => [$.id.eq(id)])
				.limit(1),
		),
	)
