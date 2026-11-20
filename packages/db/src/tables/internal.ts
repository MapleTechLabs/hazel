import { ChannelId, MessageId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { uuid } from "./columns"

// Tables the stores' migrations do not own: their DDL is written elsewhere (the object runtime, the
// sync runtime, `messageSearchStatements`, SQLite itself), so these are query schemas only
// (`external: true`, no DDL, in no store's table list). They let that code query through the builder.

/** `_object_meta`: an object's own small facts (`apps/backend/src/worker/objects/meta.ts`). */
export const objectMetaTable = SQLite.table("_object_meta", {
	external: true,
	columns: {
		key: SQLite.text,
		value: SQLite.text,
	},
})

/** The sync runtime's change log (`packages/sync-do/src/changes.ts`). */
export const changesTable = SQLite.table("_changes", {
	external: true,
	columns: {
		seq: SQLite.integer,
		tbl: SQLite.text,
		pk: SQLite.text,
		op: SQLite.text,
		at: SQLite.integer,
	},
})

/** SQLite's own catalog. */
export const sqliteMasterTable = SQLite.table("sqlite_master", {
	external: true,
	columns: {
		type: SQLite.text,
		name: SQLite.text,
		tbl_name: SQLite.text,
		sql: SQLite.nullable(SQLite.text),
	},
})

/** `OrgObject` message search: one row per indexed message (`messageSearchStatements`). */
export const messageSearchTable = SQLite.table("message_search", {
	external: true,
	columns: {
		id: SQLite.column(SQLite.integer, { defaultExpr: "(NULL)" }),
		messageId: uuid(MessageId),
		channelId: uuid(ChannelId),
		authorId: uuid(UserId),
		conversationId: SQLite.nullable(SQLite.text),
		/** Epoch ms. */
		createdAt: SQLite.integer,
		content: SQLite.text,
	},
})

/** The message search backfill's progress per channel (`messageSearchStatements`). */
export const messageSearchBackfillTable = SQLite.table("message_search_backfill", {
	external: true,
	columns: {
		channelId: uuid(ChannelId),
		/** The backfill's start time (epoch ms), which names it. */
		generation: SQLite.integer,
		done: SQLite.column(SQLite.boolean, { default: false }),
	},
})

/** The FTS5 index over `message_search.content` (external content, `rowid` = `message_search.id`). */
export const messageSearchFtsTable = SQLite.fts5Table("message_search_fts", { content: SQLite.text })
