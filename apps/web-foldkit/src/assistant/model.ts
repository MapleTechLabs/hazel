import { Assistant } from "@hazel/domain/models"
import { AssistantItemId, AssistantThreadId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import * as Menu from "../ui/menu"

/**
 * The AI panel: a right column (a sheet on phones) where a member talks to an agent about the page
 * they are on. The agent runs on their own T3 Code, or in Hazel with their own Anthropic or OpenAI
 * key. Threads and items sync from the `OrgObject`.
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
	engine: Assistant.Engine,
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
	/** When it last changed: a step's end, for how long a turn worked. */
	updatedAtMs: Schema.Finite,
})
export type ItemRow = typeof ItemRow.Type

// STATE

/**
 * Whether a new chat has an engine to run on (`assistant.status`): `Expired` when none is connected
 * and the T3 Code sign-in lapsed; `Unknown` when the check failed (sending still tries).
 */
export const Connection = Schema.Literals(["Checking", "Connected", "NotConnected", "Expired", "Unknown"])
export type Connection = typeof Connection.Type

/** Which engines the member can use, and the one new chats start on. */
export const Engines = Schema.Struct({
	preferred: Schema.NullOr(Assistant.Engine),
	t3code: Schema.Boolean,
	anthropic: Schema.Boolean,
	openai: Schema.Boolean,
	/** The model each hosted engine runs. */
	anthropicModel: Schema.String,
	openaiModel: Schema.String,
})
export type Engines = typeof Engines.Type

export const NO_ENGINES: Engines = {
	preferred: null,
	t3code: false,
	anthropic: false,
	openai: false,
	anthropicModel: "",
	openaiModel: "",
}

/** The member typing their own API key (the setup screen, or "Add an API key" in the engine menu). */
export const KeyForm = Schema.Struct({
	provider: Assistant.HostedProvider,
	value: Schema.String,
	isSaving: Schema.Boolean,
	error: Schema.NullOr(Schema.String),
})
export type KeyForm = typeof KeyForm.Type

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

/**
 * A send that failed in transit, with the ids it went out with: sending the same text again reuses
 * them (the server takes a repeated id as the same message); editing the draft drops them.
 */
export const Retry = Schema.Struct({
	text: Schema.String,
	threadId: AssistantThreadId,
	messageId: AssistantItemId,
	context: Schema.NullOr(Assistant.Context),
	isNewThread: Schema.Boolean,
})
export type Retry = typeof Retry.Type

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
	/** The widest the page left room for when the edge was last measured; null before that. */
	edgeMaxWidth: Schema.NullOr(Schema.Finite),
	/** The organization the threads below belong to; another one's arriving starts over. */
	organizationId: Schema.NullOr(OrganizationId),
	threads: Schema.Array(ThreadRow),
	/** The open thread; null for a new chat. */
	threadId: Schema.NullOr(AssistantThreadId),
	/** The open thread's items, ordered by `createdAt` then id. */
	items: Schema.Array(ItemRow),
	connection: Connection,
	environmentLabel: Schema.NullOr(Schema.String),
	engines: Engines,
	/** Open while the member adds a key; null otherwise. */
	keyForm: Schema.NullOr(KeyForm),
	/** `assistant.setEngine` is on its way. */
	isSettingEngine: Schema.Boolean,
	engineMenu: Menu.Model,
	draft: Schema.String,
	/** The page's context goes with the next message; turned off, only that message goes without. */
	isContextIncluded: Schema.Boolean,
	pending: Schema.NullOr(Pending),
	retry: Schema.NullOr(Retry),
	/** The last write's failure, shown above the composer. */
	error: Schema.NullOr(Schema.String),
	/** The turns whose finished activity list the member opened, by the turn's key (`timeline.ts`). */
	expandedWork: Schema.Array(Schema.String),
	/** The steps whose output (a tool's) or whole text (a thought's) the member opened, by item id. */
	expandedSteps: Schema.Array(Schema.String),
	answerDrafts: AnswerDrafts,
	/** The question whose answer is on its way, until the item syncs as answered. */
	answeringItemId: Schema.NullOr(AssistantItemId),
	/** The last answer's failure, shown on its question. */
	answerError: Schema.NullOr(Schema.Struct({ itemId: AssistantItemId, message: Schema.String })),
	isUpdatingVisibility: Schema.Boolean,
	/** `assistant.stop` is on its way. */
	isStopping: Schema.Boolean,
	historyMenu: Menu.Model,
})
export type Model = typeof Model.Type

export const PANEL_ID = "ai-panel"
export const COMPOSER_ID = "ai-panel-composer"
/** The setup screen's link: what focus moves to when there is no composer. */
export const SETUP_ID = "ai-panel-setup"
export const TOGGLE_ID = "ai-panel-toggle"
export const HISTORY_MENU_ID = "ai-panel-history"
export const ENGINE_MENU_ID = "ai-panel-engine"
export const KEY_FIELD_ID = "ai-panel-key"
/** The engine menu's entry that opens the key form. */
export const ADD_KEY_KEY = "add-key"
/** The history menu's first item. */
export const NEW_CHAT_KEY = "new-chat"
