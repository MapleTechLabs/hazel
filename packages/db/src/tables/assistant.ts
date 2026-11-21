/**
 * The AI panel (`docs/assistant.md`): a member's conversations with an agent about what they are
 * looking at, in the `OrgObject`. A thread is its owner's alone until they share it with the org;
 * its items carry the owner and visibility too, so sharing is one update and needs no join to sync.
 * `assistant_followers` is the engine's bookkeeping for a running thread and is never synced.
 */
import { AssistantItemId, AssistantThreadId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, randomUuid, textEnum, timestamptz, uuid } from "./columns"

export const assistantVisibilityEnum = textEnum(["private", "organization"])
/** What runs the agent: the owner's linked T3 Code environment. */
export const assistantEngineEnum = textEnum(["t3code"])
export const assistantThreadStatusEnum = textEnum(["idle", "running", "waiting", "error"])
export const assistantItemKindEnum = textEnum([
	"user",
	"assistant",
	"reasoning",
	"tool",
	"question",
	"approval",
	"notice",
])

/** Where the member was when they asked: the panel's context chip. */
export interface AssistantContextRow {
	readonly label: string
	readonly path: string
	readonly route: string
	readonly entities: ReadonlyArray<{ readonly kind: string; readonly id: string; readonly name?: string }>
}

export const assistantThreadsTable = SQLite.table("assistant_threads", {
	columns: {
		id: SQLite.column(uuid(AssistantThreadId), { defaultExpr: randomUuid }),
		organizationId: uuid(OrganizationId),
		ownerId: uuid(UserId),
		title: SQLite.text,
		visibility: SQLite.column(assistantVisibilityEnum, { default: "private" }),
		engine: assistantEngineEnum,
		status: SQLite.column(assistantThreadStatusEnum, { default: "idle" }),
		errorMessage: SQLite.nullable(SQLite.text),
		/** The context of the latest message. */
		context: SQLite.nullable(jsonb<AssistantContextRow>()),
		/** The engine's thread (a T3 Code thread id) and a link to open it there. */
		externalThreadId: SQLite.nullable(SQLite.text),
		externalLink: SQLite.nullable(SQLite.text),
		/** Where it runs, e.g. the T3 Code environment's label. */
		engineLabel: SQLite.nullable(SQLite.text),
		lastActivityAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [SQLite.index("assistant_threads_owner_idx", ["ownerId", "lastActivityAt"])],
})
export type AssistantThread = SQLite.SelectRowOf<typeof assistantThreadsTable>
export type NewAssistantThread = SQLite.InsertRowOf<typeof assistantThreadsTable>

export const assistantItemsTable = SQLite.table("assistant_items", {
	columns: {
		id: SQLite.column(uuid(AssistantItemId), { defaultExpr: randomUuid }),
		threadId: uuid(AssistantThreadId),
		organizationId: uuid(OrganizationId),
		ownerId: uuid(UserId),
		visibility: SQLite.column(assistantVisibilityEnum, { default: "private" }),
		kind: assistantItemKindEnum,
		/** The engine's id for the item (a T3 Code activity item); null for Hazel's own. */
		externalId: SQLite.nullable(SQLite.text),
		/** The engine's run (one per message sent) the item belongs to. */
		runId: SQLite.nullable(SQLite.text),
		/** `running`, `completed`, `failed`, or the engine's own; null when it has none. */
		status: SQLite.nullable(SQLite.text),
		title: SQLite.nullable(SQLite.text),
		text: SQLite.column(SQLite.text, { default: "" }),
		/** Kind-specific: a question's options, a tool's input. */
		data: SQLite.nullable(jsonb<Record<string, unknown>>()),
		/** Who wrote a `user` item. */
		authorId: SQLite.nullable(uuid(UserId)),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("assistant_items_thread_idx", ["threadId", "createdAt"]),
		SQLite.uniqueIndex("assistant_items_external_unique", ["threadId", "externalId"]),
	],
})
export type AssistantItem = SQLite.SelectRowOf<typeof assistantItemsTable>
export type NewAssistantItem = SQLite.InsertRowOf<typeof assistantItemsTable>

/** A question the agent is waiting on: answered from the panel. */
export interface AssistantPendingQuestion {
	readonly requestId: string
	readonly itemId: string
}

/** The engine's bookkeeping for a thread it follows. Not synced. */
export const assistantFollowersTable = SQLite.table("assistant_followers", {
	columns: {
		threadId: uuid(AssistantThreadId),
		/** Activity read so far (T3 Code's `afterPosition`). */
		cursor: SQLite.nullable(SQLite.real),
		pendingQuestion: SQLite.nullable(jsonb<AssistantPendingQuestion>()),
		/** When the alarm next steps it; null while it does not run. */
		nextStepAt: SQLite.nullable(timestamptz),
		/** Steps in a row that could not reach the engine. */
		failures: SQLite.column(SQLite.integer, { default: 0 }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["threadId"],
	indexes: [SQLite.index("assistant_followers_next_step_idx", ["nextStepAt"])],
})
export type AssistantFollower = SQLite.SelectRowOf<typeof assistantFollowersTable>
