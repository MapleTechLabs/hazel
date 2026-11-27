/**
 * The assistant panel's rows and how its thread reads (`web-foldkit/src/assistant/timeline.ts`, now
 * deleted): items in order, the agent's tool calls between replies folded into a work log, its
 * thinking left where it happened.
 */
import { Assistant } from "@hazel/domain/models"
import { AssistantItemId, AssistantThreadId, UserId } from "@hazel/schema"
import { Match, Option, Schema } from "effect"
import { msOf } from "../customers/data/queries"

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

/** The thread join's row: the thread and its owner's user row, once synced. */
export interface ThreadQueryRow {
	readonly thread: Assistant.Thread
	readonly owner?: { readonly firstName: string; readonly lastName: string } | undefined
}

export const toThreadRow = ({ thread, owner }: ThreadQueryRow): ThreadRow => ({
	id: thread.id,
	ownerId: thread.ownerId,
	ownerName: owner === undefined ? null : `${owner.firstName} ${owner.lastName}`.trim() || null,
	title: thread.title,
	visibility: thread.visibility,
	status: thread.status,
	errorMessage: thread.errorMessage,
	externalLink: thread.externalLink,
	engineLabel: thread.engineLabel,
	lastActivityAtMs: msOf(thread.lastActivityAt),
})

const decodeQuestion = Schema.decodeUnknownOption(QuestionData)

export const toItemRow = (item: Assistant.Item): ItemRow => ({
	id: item.id,
	threadId: item.threadId,
	kind: item.kind,
	status: item.status,
	title: item.title,
	text: item.text,
	input: item.kind === "tool" && typeof item.data?.input === "string" ? item.data.input : null,
	question: item.kind === "question" ? Option.getOrNull(decodeQuestion(item.data)) : null,
	createdAtMs: msOf(item.createdAt),
})

/** By `createdAt`, then id: rows written in the same millisecond keep one order everywhere. */
export const sortItems = (items: ReadonlyArray<ItemRow>): Array<ItemRow> =>
	[...items].sort((left, right) =>
		left.createdAtMs === right.createdAtMs
			? left.id < right.id
				? -1
				: left.id > right.id
					? 1
					: 0
			: left.createdAtMs - right.createdAtMs,
	)

export type Entry =
	| Readonly<{ _tag: "Item"; item: ItemRow }>
	/** Consecutive `tool` items; `key` is the first one's id. */
	| Readonly<{ _tag: "Work"; key: string; items: ReadonlyArray<ItemRow> }>

export const timelineOf = (items: ReadonlyArray<ItemRow>): Array<Entry> => {
	const entries: Array<Entry> = []
	let work: Array<ItemRow> | null = null
	for (const item of items) {
		if (item.kind !== "tool") {
			work = null
			entries.push({ _tag: "Item", item })
		} else if (work === null) {
			work = [item]
			entries.push({ _tag: "Work", key: item.id, items: work })
		} else work.push(item)
	}
	return entries
}

/** A work log's summary: whether a step runs, how many failed, and its step count. */
export const workSummaryOf = (items: ReadonlyArray<ItemRow>) => ({
	isRunning: items.some((item) => item.status === "running"),
	failed: items.filter((item) => item.status === "failed").length,
	steps: items.length,
})

/** "Worked · 2 steps · 1 failed", or "Working · ..." while a step runs. */
export const workTitleOf = (items: ReadonlyArray<ItemRow>): string => {
	const { isRunning, failed, steps } = workSummaryOf(items)
	const summary = `${steps} ${steps === 1 ? "step" : "steps"}${failed > 0 ? ` · ${failed} failed` : ""}`
	return `${isRunning ? "Working" : "Worked"} · ${summary}`
}

/**
 * Whether a thinking or work-log row shows its body: open while it runs and folded once done,
 * unless the member opened or folded it (`folds`, by item id).
 */
export const isFoldOpen = (folds: Readonly<Record<string, boolean>>, key: string, isRunning: boolean) =>
	folds[key] ?? isRunning

/** A running thinking or tool row shows its own work, so the panel's "Working..." steps aside. */
const hasOwnWorkingState = (item: ItemRow): boolean =>
	item.status === "running" && (item.kind === "reasoning" || item.kind === "tool")

/** The panel's own "Working..." under the timeline. A streaming reply shows none, so it keeps it. */
export const showsWorkingIndicator = (
	status: ThreadRow["status"] | null,
	items: ReadonlyArray<ItemRow>,
	isSending: boolean,
): boolean => isSending || (status === "running" && !items.some(hasOwnWorkingState))

/** The history menu: the member's own threads, then those shared with them; newest activity first. */
export const historyOf = (threads: ReadonlyArray<ThreadRow>, userId: UserId) => {
	const newestFirst = [...threads].sort((left, right) => right.lastActivityAtMs - left.lastActivityAtMs)
	return {
		own: newestFirst.filter((thread) => thread.ownerId === userId),
		shared: newestFirst.filter((thread) => thread.ownerId !== userId),
	}
}

export const isAnswered = (item: ItemRow): boolean =>
	item.question?.answered === true || item.status !== "running"

/** The agent is at work, or waiting on the member: Stop ends the run. */
export const isStoppable = (thread: ThreadRow | null): boolean =>
	thread?.status === "running" || thread?.status === "waiting"

const CUSTOMER_SUGGESTIONS = [
	"Summarize this customer",
	"What should we follow up on?",
	"Draft talking points for a call",
]
const CHANNEL_SUGGESTIONS = [
	"Summarize this channel",
	"What decisions were made recently?",
	"What questions are still open?",
]
const GENERIC_SUGGESTIONS = [
	"Summarize what's on this page",
	"What needs my attention today?",
	"Help me draft a message",
]

/** The new chat's suggestions, for the page the member is on. */
export const suggestionsFor = (context: Assistant.Context | null): ReadonlyArray<string> =>
	Match.value(context?.route ?? null).pipe(
		Match.when("CustomerDetail", () => CUSTOMER_SUGGESTIONS),
		Match.whenOr("ChatChannel", "ChatFiles", "ChatFilesMedia", () => CHANNEL_SUGGESTIONS),
		Match.orElse(() => GENERIC_SUGGESTIONS),
	)
