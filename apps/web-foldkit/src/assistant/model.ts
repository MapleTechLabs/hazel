import { Assistant } from "@hazel/domain/models"
import { AssistantItemId, AssistantThreadId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import * as Menu from "../ui/menu"

/**
 * The AI panel: a right column (a sheet on phones) where a member talks to an agent, running on
 * their own T3 Code, about the page they are on. Threads and items sync from the `OrgObject`.
 */

// ROWS

/** A thread as the panel keeps it: the synced row's fields it reads, dates as epoch ms. */
export const ThreadRow = Schema.Struct({
	id: AssistantThreadId,
	ownerId: UserId,
	/** The owner's name, for "Shared by"; null until their user row syncs. */
	ownerName: Schema.NullOr(Schema.String),
	title: Schema.String,
	visibility: Assistant.Visibility,
	status: Assistant.ThreadStatus,
	errorMessage: Schema.NullOr(Schema.String),
	externalLink: Schema.NullOr(Schema.String),
	engineLabel: Schema.NullOr(Schema.String),
	lastActivityAtMs: Schema.Finite,
})
export type ThreadRow = typeof ThreadRow.Type

/** A `question` item's `data`. */
export const QuestionData = Schema.Struct({
	requestId: Schema.String,
	questions: Schema.Array(Assistant.Question),
	answered: Schema.optional(Schema.Boolean),
	answers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
export type QuestionData = typeof QuestionData.Type

/** An item with its `data` read: a tool's one-line input, a question's questions. */
export const ItemRow = Schema.Struct({
	id: AssistantItemId,
	threadId: AssistantThreadId,
	kind: Assistant.ItemKind,
	status: Schema.NullOr(Schema.String),
	title: Schema.NullOr(Schema.String),
	text: Schema.String,
	input: Schema.NullOr(Schema.String),
	question: Schema.NullOr(QuestionData),
	createdAtMs: Schema.Finite,
})
export type ItemRow = typeof ItemRow.Type

// STATE

/** `assistant.status` for T3 Code; `Unknown` when the check failed (sending still tries). */
export const Connection = Schema.Literals(["Checking", "Connected", "NotConnected", "Expired", "Unknown"])
export type Connection = typeof Connection.Type

/**
 * The member's message, shown at once and until its item syncs: its id is made first
 * (`messageId`, null until then), so the synced item with the same id replaces it.
 */
export const Pending = Schema.Struct({
	text: Schema.String,
	/** Null until a new thread's id is made (the thread's id is its first message's). */
	threadId: Schema.NullOr(AssistantThreadId),
	messageId: Schema.NullOr(AssistantItemId),
	/** The page's context it goes with, as it was when sent. */
	context: Schema.NullOr(Assistant.Context),
	/** It starts the thread (`assistant.start`). */
	isNewThread: Schema.Boolean,
	isSending: Schema.Boolean,
})
export type Pending = typeof Pending.Type

/** The resize edge's drag: where it started, and the widest the page leaves room for. */
export const Drag = Schema.Struct({
	startX: Schema.Finite,
	startWidth: Schema.Finite,
	maxWidth: Schema.Finite,
})

/** Per question item, per question id, the picked labels (or the typed answer). */
export const AnswerDrafts = Schema.Record(
	Schema.String,
	Schema.Record(Schema.String, Schema.Array(Schema.String)),
)
export type AnswerDrafts = typeof AnswerDrafts.Type

/** What the panel keeps across loads: open on desktop, and its width. */
export const Stored = Schema.Struct({ isOpen: Schema.Boolean, width: Schema.NullOr(Schema.Finite) })
export type Stored = typeof Stored.Type

export const Model = Schema.Struct({
	isOpen: Schema.Boolean,
	/** Null: the default width. */
	width: Schema.NullOr(Schema.Finite),
	drag: Schema.NullOr(Drag),
	/** The organization the threads below belong to; another one's arriving starts over. */
	organizationId: Schema.NullOr(OrganizationId),
	threads: Schema.Array(ThreadRow),
	/** The open thread; null for a new chat. */
	threadId: Schema.NullOr(AssistantThreadId),
	/** The open thread's items, ordered by `createdAt` then id. */
	items: Schema.Array(ItemRow),
	connection: Connection,
	environmentLabel: Schema.NullOr(Schema.String),
	draft: Schema.String,
	/** The page's context goes with the next message; turned off, only that message goes without. */
	isContextIncluded: Schema.Boolean,
	pending: Schema.NullOr(Pending),
	/** The last write's failure, shown above the composer. */
	error: Schema.NullOr(Schema.String),
	/** The work-log rows expanded, by their first item's id. */
	expandedWork: Schema.Array(Schema.String),
	answerDrafts: AnswerDrafts,
	answeringItemId: Schema.NullOr(AssistantItemId),
	isUpdatingVisibility: Schema.Boolean,
	historyMenu: Menu.Model,
})
export type Model = typeof Model.Type

export const PANEL_ID = "ai-panel"
export const COMPOSER_ID = "ai-panel-composer"
export const HISTORY_MENU_ID = "ai-panel-history"
/** The history menu's first item. */
export const NEW_CHAT_KEY = "new-chat"
