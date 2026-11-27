// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The AI assistant panel (`web-foldkit/src/assistant`, now deleted): a member talks to an agent on
 * their own T3 Code about the page they are on. The root owns whether it is open and its column;
 * this draws the header, the thread (messages, thinking, work logs, questions) and the composer.
 */
import { Command, Component, Renderer, Subscription, UiSchema } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { Assistant } from "@hazel/domain/models"
import { AssistantItemId, AssistantThreadId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import type { MenuGroups } from "@hazel/ui/vocabulary/content"
import { and, eq, isNull } from "@tanstack/db"
import { Effect, Layer, Match, Option, Schema, Stream } from "effect"
import { Navigate } from "../app/requests"
import { parseMarkdown } from "../chat/rich-text"
import {
	historyOf,
	isAnswered,
	isFoldOpen,
	isStoppable,
	type ItemRow,
	ItemRow as ItemRowSchema,
	QuestionData,
	showsWorkingIndicator,
	sortItems,
	suggestionsFor,
	type ThreadQueryRow,
	ThreadRow,
	timelineOf,
	toItemRow,
	toThreadRow,
	workSummaryOf,
	workTitleOf,
} from "./timeline"

// STATE

/** `assistant.status` for T3 Code; `Unknown` when the check failed (sending still tries). */
export const Connection = Schema.Literals(["Checking", "Connected", "NotConnected", "Expired", "Unknown"])
export type Connection = typeof Connection.Type

/** The member's message, shown at once until its item syncs (same id), then dropped. */
export const Pending = Schema.Struct({
	text: Schema.String,
	/** Null until a new thread's id is made (a thread's id is its first message's). */
	threadId: Schema.NullOr(AssistantThreadId),
	messageId: Schema.NullOr(AssistantItemId),
	context: Schema.NullOr(Assistant.Context),
	isNewThread: Schema.Boolean,
	isSending: Schema.Boolean,
})
export type Pending = typeof Pending.Type

/** A send that failed in transit: the same text sent again reuses its ids (the server dedupes them). */
export const Retry = Schema.Struct({
	text: Schema.String,
	threadId: AssistantThreadId,
	messageId: AssistantItemId,
	context: Schema.NullOr(Assistant.Context),
	isNewThread: Schema.Boolean,
})
export type Retry = typeof Retry.Type

export const AssistantPanelProps = Schema.Struct({
	organizationId: OrganizationId,
	userId: UserId,
	/** The root draws the panel closed too (hidden), so its chat and draft survive a close. */
	open: Schema.Boolean,
	mobile: Schema.Boolean,
	/** What the member looks at, sent with a message (`Assistant.Context`). */
	context: Schema.NullOr(Assistant.Context),
	/** The T3 Code setup page (the integration's settings). */
	setupHref: Schema.String,
})
export type AssistantPanelProps = typeof AssistantPanelProps.Type

export const AssistantPanelModel = Schema.Struct({
	/** Null until the threads' live query first answers. */
	threads: Schema.Array(ThreadRow),
	/** The open thread; null for a new chat. */
	threadId: Schema.NullOr(AssistantThreadId),
	items: Schema.Array(ItemRowSchema),
	connection: Connection,
	environmentLabel: Schema.NullOr(Schema.String),
	draft: TextField.State,
	/** The page's context goes with the next message; turned off, only that message goes without. */
	isContextIncluded: Schema.Boolean,
	pending: Schema.NullOr(Pending),
	retry: Schema.NullOr(Retry),
	/** The last write's failure, shown above the composer. */
	error: Schema.NullOr(Schema.String),
	/** Thinking and work-log rows the member opened or folded, by item id. */
	folds: Schema.Record(Schema.String, Schema.Boolean),
	/** Per question item, per question id, the picked labels. */
	answerDrafts: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Array(Schema.String))),
	/** Typed answers, by `<itemId>:<questionId>`. */
	answerFields: Schema.Record(Schema.String, TextField.State),
	answeringItemId: Schema.NullOr(AssistantItemId),
	answerError: Schema.NullOr(Schema.Struct({ itemId: AssistantItemId, message: Schema.String })),
	isUpdatingVisibility: Schema.Boolean,
	isStopping: Schema.Boolean,
})
export type AssistantPanelModel = typeof AssistantPanelModel.Type

export const AssistantPanelMessage = UiSchema.TaggedEnum({
	UpdatedThreads: { threads: Schema.Array(ThreadRow) },
	UpdatedItems: { threadId: AssistantThreadId, items: Schema.Array(ItemRowSchema) },
	/** The root opened the panel (or it mounted open). */
	Opened: {},
	SucceededFetchStatus: { connection: Connection, environmentLabel: Schema.NullOr(Schema.String) },
	FailedFetchStatus: {},
	ChangedDraft: { payload: TextField.ChangePayload },
	SubmittedComposer: { payload: TextField.ChangePayload },
	PressedSuggestion: { text: Schema.String },
	PressedContext: {},
	MadeMessageId: { messageId: AssistantItemId },
	SucceededSend: { threadId: AssistantThreadId, messageId: AssistantItemId },
	/** `isRetryable`: it failed in transit, so sending it again reuses its ids. */
	FailedSend: {
		threadId: AssistantThreadId,
		messageId: AssistantItemId,
		message: Schema.String,
		isRetryable: Schema.Boolean,
	},
	PressedNewChat: {},
	PickedHistoryEntry: { id: Schema.String },
	PressedStop: {},
	SucceededStop: {},
	FailedStop: { threadId: AssistantThreadId, message: Schema.String },
	PressedShare: {},
	SucceededUpdateVisibility: {},
	FailedUpdateVisibility: { message: Schema.String },
	ToggledFold: { key: Schema.String, open: Schema.Boolean },
	ChangedAnswerChoice: {
		itemId: AssistantItemId,
		questionId: Schema.String,
		selected: Schema.Array(Schema.String),
	},
	ChangedAnswerText: {
		itemId: AssistantItemId,
		questionId: Schema.String,
		payload: TextField.ChangePayload,
	},
	PressedSendAnswer: { itemId: AssistantItemId },
	SucceededAnswer: { itemId: AssistantItemId },
	FailedAnswer: { itemId: AssistantItemId, message: Schema.String },
	PressedSetup: {},
	PressedClose: {},
	PressedLink: { url: Schema.String },
})
export type AssistantPanelMessage = typeof AssistantPanelMessage.Type

export const AssistantPanelEvents = UiSchema.TaggedEnum({ RequestedClose: {} })
export type AssistantPanelEvents = typeof AssistantPanelEvents.Type

/** `assistant.send`'s limit. */
export const MAX_MESSAGE_LENGTH = 20_000
export const NEW_CHAT_KEY = "new-chat"
export const GONE_THREAD = "This chat is no longer available."
const THREAD_GONE = "This chat no longer exists."
const UNREACHABLE = "Couldn't reach Hazel. Check your connection and try again."

// COMMANDS

const M = AssistantPanelMessage
const target = { organizationId: OrganizationId, threadId: AssistantThreadId }

/** A fresh id for the member's next message (and for the thread it starts: they share it). */
export class MakeMessageId extends Command.Service<MakeMessageId>()("hazel/assistant/MakeMessageId", {
	args: {},
	success: AssistantPanelMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.succeed(() =>
			Effect.sync(() => M.MadeMessageId({ messageId: AssistantItemId.make(crypto.randomUUID()) })),
		),
	)
}

const sendArgs = {
	...target,
	messageId: AssistantItemId,
	message: Schema.String,
	context: Schema.NullOr(Assistant.Context),
}

/** The engine's own message says what to do; any other failure reads as one in transit. */
const sent = (threadId: AssistantThreadId, messageId: AssistantItemId) => {
	const failed = (message: string, isRetryable: boolean) =>
		Effect.succeed(M.FailedSend({ threadId, messageId, message, isRetryable }))
	return {
		succeeded: M.SucceededSend({ threadId, messageId }),
		failures: {
			AssistantEngineError: ({ message }: { readonly message: string }) => failed(message, false),
			AssistantThreadNotFoundError: () => failed(THREAD_GONE, false),
		},
		// BOUNDARY: offline, signed out or the server: the ids are kept, so a retry is the same message.
		other: (cause: unknown) =>
			Effect.logWarning("assistant send failed", cause).pipe(Effect.andThen(failed(UNREACHABLE, true))),
	}
}

/** A new thread, with the id its first message got. */
export class StartThread extends Command.Service<StartThread>()("hazel/assistant/StartThread", {
	args: sendArgs,
	success: AssistantPanelMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ messageId, ...args }) => {
				const outcome = sent(args.threadId, messageId)
				return rpc("assistant.start", args).pipe(
					Effect.as(outcome.succeeded),
					Effect.catchTags(outcome.failures),
					Effect.catchCause(outcome.other),
				)
			}
		}),
	)
}

/** A follow-up; its id makes a retried send a no-op. */
export class SendMessage extends Command.Service<SendMessage>()("hazel/assistant/SendMessage", {
	args: sendArgs,
	success: AssistantPanelMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return (args) => {
				const outcome = sent(args.threadId, args.messageId)
				return rpc("assistant.send", args).pipe(
					Effect.as(outcome.succeeded),
					Effect.catchTags(outcome.failures),
					Effect.catchCause(outcome.other),
				)
			}
		}),
	)
}

export class AnswerQuestion extends Command.Service<AnswerQuestion>()("hazel/assistant/AnswerQuestion", {
	args: { ...target, itemId: AssistantItemId, answers: Schema.Record(Schema.String, Schema.String) },
	success: AssistantPanelMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return (args) => {
				const failed = (message: string) =>
					Effect.succeed(M.FailedAnswer({ itemId: args.itemId, message }))
				return rpc("assistant.answer", args).pipe(
					Effect.as(M.SucceededAnswer({ itemId: args.itemId })),
					Effect.catchTags({
						AssistantEngineError: ({ message }) => failed(message),
						AssistantThreadNotFoundError: () => failed(THREAD_GONE),
						AssistantQuestionClosedError: () => failed("This question was already answered."),
					}),
					// BOUNDARY: every other failure (offline, the server) reads the same here.
					Effect.tapCause((cause) => Effect.logWarning("assistant answer failed", cause)),
					Effect.catchCause(() => failed(UNREACHABLE)),
				)
			}
		}),
	)
}

export class StopThread extends Command.Service<StopThread>()("hazel/assistant/StopThread", {
	args: target,
	success: AssistantPanelMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return (args) => {
				const failed = (message: string) =>
					Effect.succeed(M.FailedStop({ threadId: args.threadId, message }))
				return rpc("assistant.stop", args).pipe(
					Effect.as(M.SucceededStop()),
					Effect.catchTags({
						AssistantEngineError: ({ message }) => failed(message),
						AssistantThreadNotFoundError: () => failed(THREAD_GONE),
					}),
					// BOUNDARY: every other failure (offline, the server) reads the same here.
					Effect.tapCause((cause) => Effect.logWarning("assistant stop failed", cause)),
					Effect.catchCause(() => failed(UNREACHABLE)),
				)
			}
		}),
	)
}

export class UpdateVisibility extends Command.Service<UpdateVisibility>()(
	"hazel/assistant/UpdateVisibility",
	{ args: { ...target, visibility: Assistant.Visibility }, success: AssistantPanelMessage },
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return (args) =>
				rpc("assistant.update", args).pipe(
					Effect.as(M.SucceededUpdateVisibility()),
					Effect.catchTag("AssistantThreadNotFoundError", () =>
						Effect.succeed(M.FailedUpdateVisibility({ message: THREAD_GONE })),
					),
					// BOUNDARY: every other failure (offline, the server) reads the same here.
					Effect.tapCause((cause) => Effect.logWarning("assistant share failed", cause)),
					Effect.catchCause(() =>
						Effect.succeed(M.FailedUpdateVisibility({ message: UNREACHABLE })),
					),
				)
		}),
	)
}

/** Whether the member's T3 Code is linked; asked each time the panel opens. */
export class FetchStatus extends Command.Service<FetchStatus>()("hazel/assistant/FetchStatus", {
	args: { organizationId: OrganizationId },
	success: AssistantPanelMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return (args) =>
				rpc("assistant.status", args).pipe(
					Effect.map(({ t3code }) =>
						M.SucceededFetchStatus({
							connection: Match.value(t3code.state).pipe(
								Match.when("connected", (): Connection => "Connected"),
								Match.when("not_connected", (): Connection => "NotConnected"),
								Match.when("expired", (): Connection => "Expired"),
								Match.exhaustive,
							),
							environmentLabel: t3code.environmentLabel,
						}),
					),
					// BOUNDARY: a failed check is `Unknown`; sending still tries.
					Effect.catchCause(() => Effect.succeed(M.FailedFetchStatus())),
				)
		}),
	)
}

/** The composer, so a Command can focus it. */
export const ComposerRef = Renderer.ref("AssistantPanel.composer")

export class FocusComposer extends Command.Service<FocusComposer>()("hazel/assistant/FocusComposer", {
	args: {},
	success: Component.Noop,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const host = yield* Hazel.Host
			return () =>
				Effect.gen(function* () {
					// After the render that shows the panel: a hidden field takes no focus.
					yield* Effect.sleep("16 millis")
					const refs = yield* Renderer.Refs
					const node = yield* refs.lookup(ComposerRef)
					// SAFETY: a ref resolves to the node its host created (`Hazel.HostNode`).
					if (Option.isSome(node)) yield* host.focus(node.value as Hazel.HostNode)
					return Component.noop
				})
		}),
	)
}

// LIVE ROWS

const threadsStream = (organizationId: OrganizationId) =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			(data) => {
				const { assistantThreadCollection, userCollection } = data.collections
				return data.liveQueryStream<ThreadQueryRow, AssistantPanelMessage>(
					(q) =>
						q
							.from({ thread: assistantThreadCollection })
							.leftJoin({ owner: userCollection }, ({ thread, owner }) =>
								eq(owner.id, thread.ownerId),
							)
							.where(({ thread }) =>
								and(eq(thread.organizationId, organizationId), isNull(thread.deletedAt)),
							),
					(rows) => M.UpdatedThreads({ threads: rows.map(toThreadRow) }),
				)
			},
		),
	)

const itemsStream = (threadId: AssistantThreadId) =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			(data) =>
				data.liveQueryStream<Assistant.Item, AssistantPanelMessage>(
					(q) =>
						q
							.from({ item: data.collections.assistantItemCollection })
							.where(({ item }) => and(eq(item.threadId, threadId), isNull(item.deletedAt))),
					(rows) => M.UpdatedItems({ threadId, items: rows.map(toItemRow) }),
				),
		),
	)

// DERIVED

type Model = AssistantPanelModel
type Props = AssistantPanelProps

export const threadOf = (model: Model): ThreadRow | null =>
	model.threads.find((thread) => thread.id === model.threadId) ?? null

/** Someone else's shared thread: read only. */
export const isReadOnly = (model: Model, props: Props): boolean => {
	const thread = threadOf(model)
	return thread !== null && thread.ownerId !== props.userId
}

/** The optimistic message, while it belongs to the thread on screen. */
export const pendingOf = (model: Model): Pending | null =>
	model.pending !== null && model.pending.threadId === model.threadId ? model.pending : null

/** The member's message synced as its own item (same id): the optimistic copy goes. */
const reconciled = (model: Model): Model => {
	const pending = pendingOf(model)
	return pending?.messageId != null && model.items.some((item) => item.id === pending.messageId)
		? { ...model, pending: null }
		: model
}

const fieldKey = (itemId: string, questionId: string) => `${itemId}:${questionId}`

/** Every question of the item answered, as `assistant.answer` takes them; null while one is not. */
export const answersOf = (model: Model, item: ItemRow): Record<string, string> | null => {
	const questions = item.question?.questions ?? []
	const drafts = model.answerDrafts[item.id] ?? {}
	const answers = Object.fromEntries(
		questions.map((question) => [
			question.id,
			(question.options ?? []).length === 0
				? (model.answerFields[fieldKey(item.id, question.id)]?.text ?? "").trim()
				: (drafts[question.id] ?? []).join(", ").trim(),
		]),
	)
	return questions.length > 0 && Object.values(answers).every((answer) => answer !== "") ? answers : null
}

// TRANSITIONS

export const init = (): Model => ({
	threads: [],
	threadId: null,
	items: [],
	connection: "Checking",
	environmentLabel: null,
	draft: TextField.empty,
	isContextIncluded: true,
	pending: null,
	retry: null,
	error: null,
	folds: {},
	answerDrafts: {},
	answerFields: {},
	answeringItemId: null,
	answerError: null,
	isUpdatingVisibility: false,
	isStopping: false,
})

/** Another thread, or a new chat (`null`): its own items, drafts and errors. */
const showThread = (model: Model, threadId: Model["threadId"]): Model => ({
	...model,
	threadId,
	items: [],
	pending: null,
	retry: null,
	error: null,
	folds: {},
	answerDrafts: {},
	answerFields: {},
	answeringItemId: null,
	answerError: null,
	isStopping: false,
	isContextIncluded: true,
})

/** The open thread was here and is gone (unshared, deleted): a new chat, saying so. */
const updatedThreads = (model: Model, threads: ReadonlyArray<ThreadRow>): Model => {
	const isGone =
		model.threadId !== null &&
		model.threads.some((thread) => thread.id === model.threadId) &&
		!threads.some((thread) => thread.id === model.threadId)
	const next = { ...model, threads }
	return isGone ? { ...showThread(next, null), error: GONE_THREAD } : next
}

/** New items: the optimistic message goes once synced, an answered question's drafts too. */
const updatedItems = (model: Model, items: ReadonlyArray<ItemRow>): Model => {
	const sorted = sortItems(items)
	const answered = new Set<string>(
		sorted.filter((item) => item.kind === "question" && isAnswered(item)).map((item) => item.id),
	)
	return reconciled({
		...model,
		items: sorted,
		answerDrafts: Object.fromEntries(
			Object.entries(model.answerDrafts).filter(([itemId]) => !answered.has(itemId)),
		),
		answeringItemId:
			model.answeringItemId !== null && answered.has(model.answeringItemId)
				? null
				: model.answeringItemId,
	})
}

/** The failed send to reuse for `message`: the same text, in the same conversation. */
const retryFor = (model: Model, message: string): Retry | null => {
	const retry = model.retry
	return retry !== null &&
		retry.text === message &&
		(retry.threadId === model.threadId || (retry.isNewThread && model.threadId === null))
		? retry
		: null
}

type SendStep =
	| { readonly model: Model; readonly next: "none" }
	| { readonly model: Model; readonly next: "makeId" }
	| { readonly model: Model; readonly next: "send"; readonly messageId: AssistantItemId }

/** Sends `text`: shown at once, then sent once its id is made, or at once with a retry's ids. */
export const send = (model: Model, props: Props, text: string, isDraft: boolean): SendStep => {
	const message = text.trim()
	if (message === "" || model.pending?.isSending === true || isReadOnly(model, props))
		return { model, next: "none" }
	if (message.length > MAX_MESSAGE_LENGTH)
		return { model: { ...model, error: "This message is too long to send." }, next: "none" }
	const retry = retryFor(model, message)
	const next: Model = {
		...model,
		draft: isDraft ? TextField.set(model.draft, "") : model.draft,
		pending: {
			text: message,
			threadId: model.threadId,
			messageId: null,
			context: retry?.context ?? (model.isContextIncluded ? props.context : null),
			isNewThread: model.threadId === null,
			isSending: true,
		},
		retry: null,
		error: null,
		isContextIncluded: true,
	}
	return retry === null
		? { model: next, next: "makeId" }
		: { model: next, next: "send", messageId: retry.messageId }
}

/** The message has its id: a new thread is open from here on, so its items stream in. */
export const madeMessageId = (model: Model, props: Props, messageId: AssistantItemId) => {
	const pending = pendingOf(model)
	if (pending === null || pending.messageId !== null) return { model, command: null }
	const threadId = pending.threadId ?? AssistantThreadId.make(messageId)
	const args = {
		organizationId: props.organizationId,
		threadId,
		messageId,
		message: pending.text,
		context: pending.context,
	}
	return {
		model: { ...model, threadId, pending: { ...pending, threadId, messageId } },
		command: pending.isNewThread ? StartThread.make(args) : SendMessage.make(args),
	}
}

/** The message comes back into the composer, unless another was typed; a thread that never started goes. */
const failedSend = (
	model: Model,
	failed: {
		threadId: AssistantThreadId
		messageId: AssistantItemId
		message: string
		isRetryable: boolean
	},
): Model => {
	const pending = model.pending?.messageId === failed.messageId ? model.pending : null
	if (pending === null) return model
	const isUnstarted = pending.isNewThread && !model.threads.some((thread) => thread.id === failed.threadId)
	const isRestored = model.draft.text === ""
	return {
		...model,
		threadId: isUnstarted ? null : model.threadId,
		items: isUnstarted ? [] : model.items,
		draft: isRestored ? TextField.set(model.draft, pending.text) : model.draft,
		pending: null,
		retry:
			failed.isRetryable && isRestored
				? {
						text: pending.text,
						threadId: failed.threadId,
						messageId: failed.messageId,
						context: pending.context,
						isNewThread: pending.isNewThread,
					}
				: null,
		error: failed.message,
	}
}

/** An edit makes it another message: a failed send's ids no longer apply. */
const changedDraft = (model: Model, payload: TextField.ChangePayload): Model => {
	const draft = TextField.changed(model.draft, payload)
	return {
		...model,
		draft,
		retry: model.retry !== null && model.retry.text !== draft.text.trim() ? null : model.retry,
	}
}

/** The open thread, when the member owns it (only the owner writes). */
const ownThread = (model: Model, props: Props): ThreadRow | null => {
	const thread = threadOf(model)
	return thread === null || thread.ownerId !== props.userId ? null : thread
}

// VIEW

const PanelDef = Hazel.component({
	name: "AssistantPanel",
	props: AssistantPanelProps,
	model: AssistantPanelModel,
	message: AssistantPanelMessage,
	events: AssistantPanelEvents,
})

type H = Parameters<Parameters<typeof PanelDef.make>[0]["view"]>[0]

const historyEntries = (model: Model, userId: UserId): MenuGroups => {
	const { own, shared } = historyOf(model.threads, userId)
	// HAZEL-GAP(p4-menu-entry-description): today a shared chat's row says "Shared by <name>" under its title.
	const toEntry = (thread: ThreadRow) => ({ id: thread.id, label: thread.title || "Untitled chat" })
	return [
		{ entries: [{ id: NEW_CHAT_KEY, label: "New chat" }] },
		...(own.length === 0 ? [] : [{ title: "Your chats", entries: own.map(toEntry) }]),
		...(shared.length === 0 ? [] : [{ title: "Shared with you", entries: shared.map(toEntry) }]),
	]
}

const toolbarButton = (h: H, label: string, icon: "plus" | "close", message: AssistantPanelMessage) =>
	h.button.label(label).icon(icon).iconOnly().variant("ghost").size("small").on("press", message)

const toolbar = (h: H, model: Model) => {
	const thread = threadOf(model)
	const isOwner = thread !== null && thread.ownerId === h.props.userId
	const isShared = thread?.visibility === "organization"
	return h.stack
		.axis("horizontal")
		.density("tight")
		.children(
			h.menu
				.label("Chat history")
				.entries(historyEntries(model, h.props.userId))
				.trigger(
					h.button.label("Chat history").icon("clock").iconOnly().variant("ghost").size("small"),
				)
				.on("select", ({ id }) => M.PickedHistoryEntry({ id })),
			toolbarButton(h, "New chat", "plus", M.PressedNewChat()),
			isOwner
				? h.button
						.label(
							isShared
								? "Shared with your organization. Make private"
								: "Private. Share with your organization",
						)
						.icon(isShared ? "users" : "lock")
						.iconOnly()
						.variant("ghost")
						.size("small")
						.selected(isShared)
						.loading(model.isUpdatingVisibility)
						.on("press", M.PressedShare())
				: null,
			// HAZEL-GAP(p4-icon-link): today "Open in T3 Code" is an icon button that opens a new tab.
			thread?.externalLink ? h.link.label("Open in T3 Code").href(thread.externalLink) : null,
			toolbarButton(h, "Close assistant", "close", M.PressedClose()),
		)
}

/** Markdown as `richText` blocks; the assistant names no users, so mentions read as written. */
const markdown = (h: H, key: string, text: string) =>
	h.richText
		.key(key)
		.blocks(parseMarkdown(text, { user: () => undefined, group: () => undefined }))
		.on("pressLink", ({ url }) => M.PressedLink({ url }))

// HAZEL-GAP(p4-assistant-bubble): today the member's message is a right-aligned rounded bubble (85% wide).
const userBubble = (h: H, key: string, text: string) =>
	h.stack
		.key(key)
		.align("end")
		.children(h.frame.surface("muted").children(h.text.children(text)))

const reply = (h: H, item: ItemRow) =>
	item.title === "Plan"
		? h.frame
				.key(item.id)
				.children(
					h.stack.children(
						h.heading.level("3").children("Plan"),
						markdown(h, `${item.id}:md`, item.text),
					),
				)
		: markdown(h, item.id, item.text)

const reasoning = (h: H, model: Model, item: ItemRow) => {
	const isRunning = item.status === "running"
	return (
		h.disclosure
			.key(item.id)
			.title(isRunning ? "Thinking…" : "Thought")
			.running(isRunning)
			.open(isFoldOpen(model.folds, item.id, isRunning))
			.on("toggle", ({ open }) => M.ToggledFold({ key: item.id, open }))
			// HAZEL-GAP(disclosure-glyph): today's thought line leads with the brain glyph and a seconds clock.
			.children(markdown(h, `${item.id}:md`, item.text))
	)
}

const stepIcon = (h: H, item: ItemRow) =>
	item.status === "running"
		? h.progress.style("spinner").label("Running")
		: h.icon.name(item.status === "failed" ? "warning" : "code")

const step = (h: H, item: ItemRow) =>
	h.stack
		.key(item.id)
		.density("compact")
		.children(
			h.item
				.title(item.title ?? "Tool")
				.subtitle(item.input ?? undefined)
				.leading(stepIcon(h, item)),
			item.text === "" ? null : h.codeBlock.code(item.text),
		)

const workLog = (h: H, model: Model, key: string, items: ReadonlyArray<ItemRow>) => {
	const { isRunning } = workSummaryOf(items)
	return h.disclosure
		.key(key)
		.title(workTitleOf(items))
		.running(isRunning)
		.open(isFoldOpen(model.folds, key, isRunning))
		.on("toggle", ({ open }) => M.ToggledFold({ key, open }))
		.children(h.stack.density("compact").children(...items.map((item) => step(h, item))))
}

const question = (h: H, model: Model, item: ItemRow, data: QuestionData) => {
	const isLocked = isReadOnly(model, h.props) || model.answeringItemId === item.id
	const drafts = model.answerDrafts[item.id] ?? {}
	const error = model.answerError?.itemId === item.id ? model.answerError.message : null
	if (isAnswered(item))
		return h.frame.key(item.id).children(
			...data.questions.map((entry) =>
				h.property
					.key(entry.id)
					.label(entry.header ?? entry.question)
					.children(h.text.children(data.answers?.[entry.id] ?? "Answered")),
			),
		)
	return h.frame.key(item.id).children(
		h.stack.density("relaxed").children(
			...data.questions.map((entry) => {
				const options = entry.options ?? []
				return h.stack.key(entry.id).children(
					entry.header === undefined ? null : h.heading.level("3").children(entry.header),
					options.length === 0
						? h.textArea
								.label(entry.question)
								.placeholder("Your answer")
								.value(model.answerFields[fieldKey(item.id, entry.id)] ?? TextField.empty)
								.disabled(isLocked)
								.on("change", (payload) =>
									M.ChangedAnswerText({ itemId: item.id, questionId: entry.id, payload }),
								)
						: h.choiceGroup
								.label(entry.question)
								.style("chips")
								.multiple(entry.multiSelect === true)
								.options(
									options.map((option) => ({
										value: option.label,
										label: option.label,
										description: option.description,
									})),
								)
								.selected(drafts[entry.id] ?? [])
								.disabled(isLocked)
								.on("change", ({ selected }) =>
									M.ChangedAnswerChoice({
										itemId: item.id,
										questionId: entry.id,
										selected,
									}),
								),
				)
			}),
			error === null ? null : h.text.tone("danger").children(error),
			isReadOnly(model, h.props)
				? null
				: h.stack
						.axis("horizontal")
						.align("end")
						.children(
							h.button
								.label("Send answer")
								.size("small")
								.disabled(answersOf(model, item) === null)
								.loading(model.answeringItemId === item.id)
								.on("press", M.PressedSendAnswer({ itemId: item.id })),
						),
		),
	)
}

const approval = (h: H, item: ItemRow, externalLink: string | null) =>
	h.banner
		.key(item.id)
		.tone("warning")
		.title("Waiting for approval in T3 Code")
		.description(item.title ?? (item.text || undefined))
		.actions(externalLink === null ? null : h.link.label("Open in T3 Code").href(externalLink))

const entryView = (h: H, model: Model, item: ItemRow, externalLink: string | null) =>
	Match.value(item.kind).pipe(
		Match.when("user", () => userBubble(h, item.id, item.text)),
		Match.when("assistant", () => reply(h, item)),
		Match.when("reasoning", () => reasoning(h, model, item)),
		Match.when("question", () =>
			item.question === null ? null : question(h, model, item, item.question),
		),
		Match.when("approval", () => approval(h, item, externalLink)),
		// HAZEL-GAP(p4-text-align): today a notice is a centred caption.
		Match.whenOr("notice", "tool", () =>
			h.text
				.key(item.id)
				.role("caption")
				.tone("muted")
				.children(item.text || item.title || ""),
		),
		Match.exhaustive,
	)

const newChat = (h: H, model: Model) =>
	h.stack
		.key("new-chat")
		.density("relaxed")
		.children(
			h.stack.children(
				h.heading.level("3").children("Ask about what you're looking at"),
				h.text
					.tone("muted")
					.children(
						"The assistant reads this page and recommends what to do; it never changes anything itself.",
					),
			),
			h.stack.align("start").children(
				...suggestionsFor(h.props.context).map((text) =>
					h.button
						.key(text)
						.label(text)
						.variant("outline")
						.size("small")
						.disabled(model.pending?.isSending === true)
						.on("press", M.PressedSuggestion({ text })),
				),
			),
		)

const timeline = (h: H, model: Model) => {
	const pending = pendingOf(model)
	const thread = threadOf(model)
	// Anchored at the end, as today's reversed column: the newest row stays in view as it grows.
	const rows = (...children: ReadonlyArray<unknown>) =>
		h.list
			.anchor("end")
			.stickToBottom()
			.children(h.stack.key("rows").children(...(children as Array<never>)))
	if (model.threadId === null && pending === null) return rows(newChat(h, model))
	const externalLink = thread?.externalLink ?? null
	return rows(
		...timelineOf(model.items).map((entry) =>
			entry._tag === "Work"
				? workLog(h, model, entry.key, entry.items)
				: entryView(h, model, entry.item, externalLink),
		),
		// HAZEL-GAP(p4-pending-look): today the message on its way is drawn at 70% opacity.
		pending === null ? null : userBubble(h, pending.messageId ?? "pending", pending.text),
		showsWorkingIndicator(thread?.status ?? null, model.items, pending?.isSending === true)
			? h.progress.key("working").style("spinner").label("Working…")
			: null,
		thread?.status === "error"
			? h.banner
					.key("error")
					.tone("danger")
					.description(thread.errorMessage ?? "The assistant stopped with an error.")
			: null,
	)
}

const composer = (h: H, model: Model) => {
	const thread = threadOf(model)
	const context = h.props.context
	const engineLabel = thread?.engineLabel ?? model.environmentLabel
	const isSending = model.pending?.isSending === true
	// HAZEL-GAP(p4-panel-inset): today the composer sits 12px in from the panel's edges.
	return h.stack.density("compact").children(
		model.error === null ? null : h.text.tone("danger").children(model.error),
		h.composer
			.ref(ComposerRef)
			.placeholder(context === null ? "Ask anything" : `Ask about ${context.label}`)
			.value(model.draft)
			// HAZEL-GAP(p4-composer-stop): today Stop replaces the send button while the agent runs.
			.canSend(model.draft.text.trim() !== "" && !isSending && !isStoppable(thread))
			.above(
				context === null
					? null
					: h.button
							.label(context.label)
							.variant("chip")
							.size("xsmall")
							.selected(model.isContextIncluded)
							.on("press", M.PressedContext()),
			)
			.actions(
				h.stack.axis("horizontal").children(
					h.text
						.role("caption")
						.tone("muted")
						.truncate()
						.children(engineLabel === null ? "T3 Code" : `T3 Code · ${engineLabel}`),
					isStoppable(thread)
						? h.button
								.label("Stop")
								.variant("secondary")
								.size("small")
								.loading(model.isStopping)
								.on("press", M.PressedStop())
						: null,
				),
			)
			.on("change", (payload) => M.ChangedDraft({ payload }))
			.on("submit", (payload) => M.SubmittedComposer({ payload })),
	)
}

const sharedFooter = (h: H, thread: ThreadRow) =>
	h.item.title(`Shared by ${thread.ownerName ?? "a teammate"}`).leading(h.icon.name("users"))

const connectState = (h: H, model: Model) => {
	const isExpired = model.connection === "Expired"
	// Already on the setup page: point at its form instead of a link back to the same page.
	const isOnSetupPage = h.props.context?.path === h.props.setupHref
	return h.emptyState
		.icon("sparkles")
		.title(isExpired ? "Your T3 Code sign-in expired" : "Connect T3 Code")
		.description(
			isOnSetupPage
				? isExpired
					? "Reconnect your environment on this page to keep chatting."
					: "Link your environment on this page, then chat with an agent that sees what you can see."
				: isExpired
					? "Sign in to T3 Code again to keep chatting with your environment."
					: "The assistant runs on your own T3 Code environment, so it sees what you can see.",
		)
		.action(
			isOnSetupPage
				? null
				: h.button
						.label(isExpired ? "Link T3 Code again" : "Open T3 Code settings")
						.size("small")
						.on("press", M.PressedSetup()),
		)
}

const body = (h: H, model: Model) => {
	const thread = threadOf(model)
	const isConnected = model.connection !== "NotConnected" && model.connection !== "Expired"
	// Until it is known whether T3 Code is linked, a new chat offers nothing to send.
	if (model.connection === "Checking" && model.threadId === null)
		return [h.progress.style("spinner").label("Checking T3 Code")]
	if (!isConnected && model.threadId === null) return [connectState(h, model)]
	return [
		timeline(h, model),
		thread !== null && isReadOnly(model, h.props) ? sharedFooter(h, thread) : composer(h, model),
	]
}

// UPDATE

type Step = { readonly model: Model; readonly command: Command.Command<any, any> | null }

export const AssistantPanelNoDeps = PanelDef.make({
	init: () => init(),
	update: {
		UpdatedThreads: ($, { threads }) => $.set(updatedThreads($.model, threads)),
		UpdatedItems: ($, { threadId, items }) =>
			threadId === $.model.threadId ? $.set(updatedItems($.model, items)) : $.model,
		Opened: ($) =>
			$.set({ ...$.model, error: null }).run(
				FetchStatus.make({ organizationId: $.props.organizationId }),
				FocusComposer.make({}),
			),
		SucceededFetchStatus: ($, { connection, environmentLabel }) =>
			$.evolve({ connection: () => connection, environmentLabel: () => environmentLabel }),
		FailedFetchStatus: ($) => $.evolve({ connection: () => "Unknown" as const }),
		ChangedDraft: ($, { payload }) => $.set(changedDraft($.model, payload)),
		SubmittedComposer: ($, { payload }) => {
			const model = changedDraft($.model, payload)
			const step = send(model, $.props, model.draft.text, true)
			return runSend($, step)
		},
		PressedSuggestion: ($, { text }) => runSend($, send($.model, $.props, text, false)),
		PressedContext: ($) => $.evolve({ isContextIncluded: (included) => !included }),
		MadeMessageId: ($, { messageId }) => {
			const next = madeMessageId($.model, $.props, messageId)
			return next.command === null ? $.set(next.model) : $.set(next.model).run(next.command)
		},
		SucceededSend: ($, { messageId }) => {
			const pending = $.model.pending
			if (pending === null || pending.messageId !== messageId) return $.model
			return $.set(reconciled({ ...$.model, pending: { ...pending, isSending: false } }))
		},
		FailedSend: ($, failed) => $.set(failedSend($.model, failed)),
		PressedNewChat: ($) =>
			$.model.threadId === null
				? $.run(FocusComposer.make({}))
				: $.set(showThread($.model, null)).run(FocusComposer.make({})),
		PickedHistoryEntry: ($, { id }) => {
			if (id === NEW_CHAT_KEY)
				return $.model.threadId === null
					? $.model
					: $.set(showThread($.model, null)).run(FocusComposer.make({}))
			const thread = $.model.threads.find((candidate) => candidate.id === id)
			return thread === undefined || thread.id === $.model.threadId
				? $.model
				: $.set(showThread($.model, thread.id)).run(FocusComposer.make({}))
		},
		PressedStop: ($) => {
			const thread = ownThread($.model, $.props)
			return thread === null || $.model.isStopping || !isStoppable(thread)
				? $.model
				: $.set({ ...$.model, isStopping: true, error: null }).run(
						StopThread.make({ organizationId: $.props.organizationId, threadId: thread.id }),
					)
		},
		SucceededStop: ($) => $.evolve({ isStopping: () => false }),
		// The error belongs to the chat that was stopped: shown only while it is on screen.
		FailedStop: ($, { threadId, message }) =>
			$.evolve({
				isStopping: () => false,
				error: (error) => (threadId === $.model.threadId ? message : error),
			}),
		PressedShare: ($) => {
			const thread = ownThread($.model, $.props)
			return thread === null || $.model.isUpdatingVisibility
				? $.model
				: $.set({ ...$.model, isUpdatingVisibility: true, error: null }).run(
						UpdateVisibility.make({
							organizationId: $.props.organizationId,
							threadId: thread.id,
							visibility: thread.visibility === "private" ? "organization" : "private",
						}),
					)
		},
		SucceededUpdateVisibility: ($) => $.evolve({ isUpdatingVisibility: () => false }),
		FailedUpdateVisibility: ($, { message }) =>
			$.evolve({ isUpdatingVisibility: () => false, error: () => message }),
		ToggledFold: ($, { key, open }) => $.evolve({ folds: (folds) => ({ ...folds, [key]: open }) }),
		ChangedAnswerChoice: ($, { itemId, questionId, selected }) =>
			$.evolve({
				answerDrafts: (drafts) => ({
					...drafts,
					[itemId]: { ...drafts[itemId], [questionId]: selected },
				}),
			}),
		ChangedAnswerText: ($, { itemId, questionId, payload }) =>
			$.evolve({
				answerFields: (fields) => {
					const key = fieldKey(itemId, questionId)
					return { ...fields, [key]: TextField.changed(fields[key] ?? TextField.empty, payload) }
				},
			}),
		PressedSendAnswer: ($, { itemId }) => {
			const item = $.model.items.find((candidate) => candidate.id === itemId)
			const answers = item === undefined ? null : answersOf($.model, item)
			if (
				item === undefined ||
				answers === null ||
				$.model.answeringItemId !== null ||
				isReadOnly($.model, $.props)
			)
				return $.model
			return $.set({ ...$.model, answeringItemId: itemId, answerError: null }).run(
				AnswerQuestion.make({
					organizationId: $.props.organizationId,
					threadId: item.threadId,
					itemId,
					answers,
				}),
			)
		},
		// The answer stays in flight until the question syncs as answered (`updatedItems`).
		SucceededAnswer: ($) => $.model,
		FailedAnswer: ($, { itemId, message }) =>
			$.evolve({
				answeringItemId: (current) => (current === itemId ? null : current),
				answerError: () => ({ itemId, message }),
			}),
		// On a phone the panel covers the page it opens: it closes on the way.
		PressedSetup: ($) => {
			const step = $.run(Navigate.make({ href: $.props.setupHref, replace: false }))
			return $.props.mobile ? step.emit(AssistantPanelEvents.RequestedClose()) : step
		},
		PressedClose: ($) => $.emit(AssistantPanelEvents.RequestedClose()),
		PressedLink: ($, { url }) =>
			url.startsWith("/") ? $.run(Navigate.make({ href: url, replace: false })) : $.model,
	},
	subscriptions: ({ props, model }) => [
		Subscription.make("threads", [props.open ? props.organizationId : null], ([organizationId]) =>
			organizationId === null ? Stream.empty : threadsStream(organizationId),
		),
		Subscription.make("items", [props.open ? model.threadId : null], ([threadId]) =>
			threadId === null ? Stream.empty : itemsStream(threadId),
		),
		Subscription.make("opened", [props.open], ([open]) =>
			open ? Stream.make(M.Opened()) : Stream.empty,
		),
	],
	view: (h, model) => {
		const thread = threadOf(model)
		return h.screen
			.surface("panel")
			.title(thread === null || thread.title === "" ? "New chat" : thread.title)
			.toolbar(toolbar(h, model))
			.children(...body(h, model))
	},
})

/** Runs a send's next step: nothing, a new id, or the retry's send with its ids. */
const runSend = ($: { set: (model: Model) => any; readonly props: Props }, step: SendStep) => {
	if (step.next === "none") return $.set(step.model)
	if (step.next === "makeId") return $.set(step.model).run(MakeMessageId.make({}))
	const sent: Step = madeMessageId(step.model, $.props, step.messageId)
	return sent.command === null ? $.set(sent.model) : $.set(sent.model).run(sent.command)
}

/** The panel with its Commands; the host provides `ClientData`, `HazelRpc`, `Hazel.Host` and `Navigate`. */
export const AssistantPanel = AssistantPanelNoDeps.pipe(
	Component.provide(
		Layer.mergeAll(
			MakeMessageId.layer,
			StartThread.layer,
			SendMessage.layer,
			AnswerQuestion.layer,
			StopThread.layer,
			UpdateVisibility.layer,
			FetchStatus.layer,
			FocusComposer.layer,
		),
	),
)
