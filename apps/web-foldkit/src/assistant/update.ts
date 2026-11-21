import { Assistant } from "@hazel/domain/models"
import { type AssistantItemId, AssistantThreadId, type OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, type Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { Shared } from "../page/contract"
import type { Resources } from "../rpc"
import * as Menu from "../ui/menu"
import * as Modal from "../ui/modal"
import {
	AnswerAssistantQuestion,
	FetchAssistantStatus,
	FocusAssistantComposer,
	MeasureAssistantEdge,
	FocusAssistantToggle,
	MakeAssistantMessageId,
	SaveAssistantKey,
	SaveAssistantPanel,
	SendAssistantMessage,
	SetAssistantEngine,
	StartAssistantThread,
	StopAssistantThread,
	UpdateAssistantVisibility,
} from "./commands"
import { Message } from "./message"
import {
	ADD_KEY_KEY,
	type Connection,
	ENGINE_MENU_ID,
	type Engines,
	HISTORY_MENU_ID,
	type ItemRow,
	NO_ENGINES,
	type Model,
	NEW_CHAT_KEY,
	PANEL_ID,
	type Retry,
	type Stored,
	type ThreadRow,
} from "./model"
import { sortItems } from "./timeline"

export type Return = Update.Return<Model, Message, Resources>

/** What the panel reads from the root: the shared state and what the page shows. */
export interface Inputs {
	readonly shared: Shared
	readonly context: Assistant.Context | null
}

/** `assistant.send`'s limit. */
export const MAX_MESSAGE_LENGTH = 20_000

// WIDTH (the thread panel's, `page/chat/channel/thread-width.ts`)

export const DEFAULT_WIDTH = 420
export const MIN_WIDTH = 320
/** The page always keeps this much room beside the panel. */
export const MIN_PAGE_WIDTH = 480
/** Arrow keys have no layout to read, so they stop here; the panel's CSS max-width still applies. */
export const MAX_KEYBOARD_WIDTH = 960

export const widthOf = (model: Pick<Model, "width">): number => model.width ?? DEFAULT_WIDTH

const clamp = (width: number, maxWidth: number) => Math.round(Math.max(MIN_WIDTH, Math.min(width, maxWidth)))

// INIT

export const init = (stored: Stored): Model => ({
	isOpen: stored.isOpen,
	width: stored.width === null ? null : clamp(stored.width, MAX_KEYBOARD_WIDTH),
	drag: null,
	edgeMaxWidth: null,
	organizationId: null,
	threads: [],
	threadId: null,
	items: [],
	connection: "Checking",
	environmentLabel: null,
	engines: NO_ENGINES,
	keyForm: null,
	isSettingEngine: false,
	engineMenu: Menu.init({ id: ENGINE_MENU_ID, placement: "top start" }),
	draft: "",
	isContextIncluded: true,
	pending: null,
	retry: null,
	error: null,
	expandedWork: [],
	answerDrafts: {},
	answeringItemId: null,
	answerError: null,
	isUpdatingVisibility: false,
	isStopping: false,
	historyMenu: Menu.init({ id: HISTORY_MENU_ID, placement: "bottom end" }),
})

// DERIVED

/** The open thread's row; null for a new chat, or a thread just started whose row has not synced. */
export const threadOf = (model: Model): ThreadRow | null =>
	model.threads.find((thread) => thread.id === model.threadId) ?? null

/** Someone else's shared thread: read only. */
export const isReadOnly = (model: Model, shared: Shared): boolean => {
	const thread = threadOf(model)
	return thread !== null && thread.ownerId !== shared.currentUser?.id
}

/** The optimistic message, while it belongs to the thread on screen and its row has not arrived. */
export const pendingOf = (model: Model) => {
	const pending = model.pending
	return pending !== null && pending.threadId === model.threadId ? pending : null
}

/** The member's message has synced as its own item (same id): the optimistic copy goes. */
const reconciled = (model: Model): Model => {
	const pending = pendingOf(model)
	return pending !== null &&
		pending.messageId !== null &&
		model.items.some((item) => item.id === pending.messageId)
		? modifyFields(model, { pending: () => null })
		: model
}

const persisted = (model: Model): Stored => ({ isOpen: model.isOpen, width: model.width })

/** A phone's open sheet is not remembered: the next load starts on the page. */
const saveCommands = (model: Model, shared: Shared) =>
	shared.isMobile ? [] : [SaveAssistantPanel({ stored: persisted(model) })]

// OPEN AND CLOSE

export const open = (model: Model, inputs: Inputs): Return => {
	if (model.isOpen) return { model, commands: [FocusAssistantComposer()] }
	const organizationId = inputs.shared.organization?.id ?? null
	// Opened in another organization than the one its thread is from: start over there.
	const base =
		organizationId !== null && model.organizationId !== null && organizationId !== model.organizationId
			? forOrganization(model, organizationId)
			: model
	const next = modifyFields(base, {
		isOpen: () => true,
		error: () => null,
		organizationId: (current) => organizationId ?? current,
	})
	return {
		model: next,
		commands: [
			FocusAssistantComposer(),
			...(organizationId === null ? [] : [FetchAssistantStatus({ organizationId })]),
			...saveCommands(next, inputs.shared),
		],
	}
}

export const close = (model: Model, inputs: Inputs): Return => {
	if (!model.isOpen) return { model }
	const next = modifyFields(model, {
		isOpen: () => false,
		drag: () => null,
		historyMenu: (menu) => modifyFields(menu, { popup: () => ({ _tag: "Closed" as const }) }),
		engineMenu: (menu) => modifyFields(menu, { popup: () => ({ _tag: "Closed" as const }) }),
	})
	return {
		model: next,
		// A phone's sheet hands focus back itself (the dialog returns it to its opener).
		commands: [
			...saveCommands(next, inputs.shared),
			...(inputs.shared.isMobile ? [] : [FocusAssistantToggle()]),
		],
	}
}

export const toggle = (model: Model, inputs: Inputs): Return =>
	model.isOpen ? close(model, inputs) : open(model, inputs)

/** The phone's sheet, as a Modal Model derived from `isOpen`. */
export const sheetModelOf = (model: Model): Modal.Model =>
	model.isOpen ? Modal.initOpen(PANEL_ID) : Modal.init(PANEL_ID)

// THREADS

/** Another thread, or a new chat (`null`): its own items, drafts and errors. */
const showThread = (model: Model, threadId: Model["threadId"]): Return => ({
	model: modifyFields(model, {
		threadId: () => threadId,
		items: () => [],
		pending: () => null,
		retry: () => null,
		error: () => null,
		expandedWork: () => [],
		answerDrafts: () => ({}),
		answeringItemId: () => null,
		answerError: () => null,
		isStopping: () => false,
		isContextIncluded: () => true,
	}),
	commands: [FocusAssistantComposer()],
})

/** Another organization: a new chat there, its own threads and its own T3 Code status. */
const forOrganization = (model: Model, organizationId: OrganizationId): Model =>
	modifyFields(showThread(model, null).model, {
		organizationId: () => organizationId,
		threads: () => [],
		draft: () => "",
		connection: () => "Checking",
		engines: () => NO_ENGINES,
		keyForm: () => null,
	})

export const GONE_THREAD = "This chat is no longer available."

const updatedThreads = (
	model: Model,
	organizationId: OrganizationId,
	threads: ReadonlyArray<ThreadRow>,
): Return => {
	// The first answer after a load only names the organization; a later one from another is a switch.
	if (model.organizationId !== null && organizationId !== model.organizationId)
		return {
			model: modifyFields(forOrganization(model, organizationId), { threads: () => threads }),
			commands: model.isOpen ? [FetchAssistantStatus({ organizationId })] : [],
		}
	const next = modifyFields(model, { organizationId: () => organizationId, threads: () => threads })
	// A panel that loaded open has not asked yet whether T3 Code is linked: ask once its org is known.
	const status =
		model.organizationId === null && model.isOpen && model.connection === "Checking"
			? [FetchAssistantStatus({ organizationId })]
			: []
	// The open thread was here and is gone (unshared, or deleted). A start whose row has not synced
	// yet was never here.
	const isGone =
		model.threadId !== null &&
		model.threads.some((thread) => thread.id === model.threadId) &&
		!threads.some((thread) => thread.id === model.threadId)
	if (!isGone) return { model: next, commands: status }
	const shown = showThread(next, null)
	return {
		model: modifyFields(shown.model, { error: () => GONE_THREAD }),
		commands: [...(shown.commands ?? []), ...status],
	}
}

const pickedHistory = (model: Model, key: string): Return => {
	if (key === NEW_CHAT_KEY) return model.threadId === null ? { model } : showThread(model, null)
	const thread = model.threads.find((candidate) => candidate.id === key)
	return thread === undefined || thread.id === model.threadId ? { model } : showThread(model, thread.id)
}

// SENDING

/** The failed send to reuse for `message`: the same text, in the same conversation. */
const retryFor = (model: Model, message: string): Retry | null => {
	const retry = model.retry
	return retry !== null &&
		retry.text === message &&
		// A first message's thread may have started (its row synced) before the failure arrived.
		(retry.threadId === model.threadId || (retry.isNewThread && model.threadId === null))
		? retry
		: null
}

/**
 * Sends `text`: shown at once, then sent once its id is made (`MakeAssistantMessageId`), or at once
 * with the ids of the same message that failed in transit. The draft is cleared only when it is
 * `text`; the page's context goes along unless the member turned it off.
 */
const send = (model: Model, text: string, inputs: Inputs, isDraft: boolean): Return => {
	const message = text.trim()
	if (
		message === "" ||
		inputs.shared.organization === null ||
		model.pending?.isSending === true ||
		isReadOnly(model, inputs.shared)
	)
		return { model }
	if (message.length > MAX_MESSAGE_LENGTH)
		return { model: modifyFields(model, { error: () => "This message is too long to send." }) }
	const retry = retryFor(model, message)
	const next = modifyFields(model, {
		draft: (draft) => (isDraft ? "" : draft),
		pending: () => ({
			text: message,
			threadId: model.threadId,
			messageId: null,
			context: retry?.context ?? (model.isContextIncluded ? inputs.context : null),
			isNewThread: model.threadId === null,
			isSending: true,
		}),
		retry: () => null,
		error: () => null,
		isContextIncluded: () => true,
	})
	return retry === null
		? { model: next, commands: [MakeAssistantMessageId()] }
		: madeMessageId(next, retry.messageId, inputs)
}

const decodeThreadId = Schema.decodeSync(AssistantThreadId)

/**
 * The message has its id: `assistant.send` it, or `assistant.start` a thread with the same id (its
 * first item's id is the thread's). A new thread is open from here on, so its items stream in.
 */
const madeMessageId = (model: Model, messageId: AssistantItemId, inputs: Inputs): Return => {
	const pending = pendingOf(model)
	const organizationId = inputs.shared.organization?.id
	if (pending === null || pending.messageId !== null || organizationId === undefined) return { model }
	const threadId = pending.threadId ?? decodeThreadId(messageId)
	const sent = { organizationId, threadId, messageId, message: pending.text, context: pending.context }
	return {
		model: modifyFields(model, {
			threadId: () => threadId,
			pending: () => modifyFields(pending, { threadId: () => threadId, messageId: () => messageId }),
		}),
		commands: [pending.isNewThread ? StartAssistantThread(sent) : SendAssistantMessage(sent)],
	}
}

/** The pending message, when it is the one an answer is about. */
const pendingWithId = (model: Model, messageId: AssistantItemId) =>
	model.pending !== null && model.pending.messageId === messageId ? model.pending : null

const succeededSend = (model: Model, messageId: AssistantItemId): Return => {
	const pending = pendingWithId(model, messageId)
	// Another message is pending now (the member moved on): this one shows once it syncs.
	if (pending === null) return { model }
	return {
		model: reconciled(
			modifyFields(model, { pending: () => modifyFields(pending, { isSending: () => false }) }),
		),
	}
}

/**
 * The message comes back into the composer, unless the member has typed another meanwhile; in
 * transit, with its ids kept for a retry. A thread that never started is left for a new chat.
 */
const failedSend = (
	model: Model,
	{
		threadId,
		messageId,
		message,
		isRetryable,
	}: Readonly<{
		threadId: AssistantThreadId
		messageId: AssistantItemId
		message: string
		isRetryable: boolean
	}>,
): Return => {
	const pending = pendingWithId(model, messageId)
	if (pending === null) return { model }
	const isUnstarted = pending.isNewThread && !model.threads.some((thread) => thread.id === threadId)
	const isRestored = model.draft === ""
	return {
		model: modifyFields(model, {
			threadId: (current) => (isUnstarted ? null : current),
			items: (items) => (isUnstarted ? [] : items),
			draft: (draft) => (isRestored ? pending.text : draft),
			pending: () => null,
			retry: () =>
				isRetryable && isRestored
					? {
							text: pending.text,
							threadId,
							messageId,
							context: pending.context,
							isNewThread: pending.isNewThread,
						}
					: null,
			error: () => message,
		}),
	}
}

/** An edit makes it another message: a failed send's ids no longer apply. */
const changedDraft = (model: Model, value: string): Model =>
	modifyFields(model, {
		draft: () => value,
		retry: (retry) => (retry !== null && retry.text !== value.trim() ? null : retry),
	})

// QUESTIONS

const setAnswer = (
	model: Model,
	itemId: AssistantItemId,
	questionId: string,
	values: ReadonlyArray<string>,
) =>
	modifyFields(model, {
		answerDrafts: (drafts) => ({ ...drafts, [itemId]: { ...drafts[itemId], [questionId]: values } }),
	})

const pickedAnswer = (
	model: Model,
	{
		itemId,
		questionId,
		label,
		isMultiSelect,
	}: Readonly<{
		itemId: AssistantItemId
		questionId: string
		label: string
		isMultiSelect: boolean
	}>,
): Model => {
	const current = model.answerDrafts[itemId]?.[questionId] ?? []
	const values = !isMultiSelect
		? [label]
		: current.includes(label)
			? current.filter((value) => value !== label)
			: [...current, label]
	return setAnswer(model, itemId, questionId, values)
}

/** Every question of the item answered, as `assistant.answer` takes them; null while one is not. */
export const answersOf = (
	answerDrafts: Model["answerDrafts"],
	item: ItemRow,
): Record<string, string> | null => {
	const questions = item.question?.questions ?? []
	const drafts = answerDrafts[item.id] ?? {}
	const answers = Object.fromEntries(
		questions.map((question) => [question.id, (drafts[question.id] ?? []).join(", ").trim()]),
	)
	return questions.length > 0 && Object.values(answers).every((answer) => answer !== "") ? answers : null
}

const submittedAnswers = (model: Model, itemId: AssistantItemId, inputs: Inputs): Return => {
	const item = model.items.find((candidate) => candidate.id === itemId)
	const organizationId = inputs.shared.organization?.id
	const answers = item === undefined ? null : answersOf(model.answerDrafts, item)
	if (
		item === undefined ||
		answers === null ||
		organizationId === undefined ||
		model.answeringItemId !== null ||
		isReadOnly(model, inputs.shared)
	)
		return { model }
	return {
		model: modifyFields(model, { answeringItemId: () => itemId, answerError: () => null }),
		commands: [AnswerAssistantQuestion({ organizationId, threadId: item.threadId, itemId, answers })],
	}
}

export const isAnswered = (item: ItemRow): boolean =>
	item.question?.answered === true || item.status !== "running"

/**
 * New items: the optimistic message goes once its own item is here, and an answered question's
 * drafts (and its in-flight answer) once it syncs as answered.
 */
const updatedItems = (model: Model, items: ReadonlyArray<ItemRow>): Model => {
	const sorted = sortItems(items)
	const answered = new Set<string>(
		sorted.filter((item) => item.kind === "question" && isAnswered(item)).map((item) => item.id),
	)
	return reconciled(
		modifyFields(model, {
			items: () => sorted,
			answerDrafts: (drafts) =>
				Object.fromEntries(Object.entries(drafts).filter(([itemId]) => !answered.has(itemId))),
			answeringItemId: (itemId) => (itemId !== null && answered.has(itemId) ? null : itemId),
		}),
	)
}

// THREAD ACTIONS

/** The open thread, when the member owns it (only the owner writes). */
const ownThread = (model: Model, inputs: Inputs) => {
	const thread = threadOf(model)
	const organizationId = inputs.shared.organization?.id
	return thread === null || organizationId === undefined || thread.ownerId !== inputs.shared.currentUser?.id
		? null
		: { thread, organizationId }
}

/** The agent is at work, or waiting on the member: Stop ends the run. */
export const isStoppable = (thread: ThreadRow | null): boolean =>
	thread?.status === "running" || thread?.status === "waiting"

const clickedStop = (model: Model, inputs: Inputs): Return => {
	const own = ownThread(model, inputs)
	return own === null || model.isStopping || !isStoppable(own.thread)
		? { model }
		: {
				model: modifyFields(model, { isStopping: () => true, error: () => null }),
				commands: [
					StopAssistantThread({ organizationId: own.organizationId, threadId: own.thread.id }),
				],
			}
}

const clickedShare = (model: Model, inputs: Inputs): Return => {
	const own = ownThread(model, inputs)
	if (own === null || model.isUpdatingVisibility) return { model }
	return {
		model: modifyFields(model, { isUpdatingVisibility: () => true, error: () => null }),
		commands: [
			UpdateAssistantVisibility({
				organizationId: own.organizationId,
				threadId: own.thread.id,
				visibility: own.thread.visibility === "private" ? "organization" : "private",
			}),
		],
	}
}

// EDGE

const pressedEdge = (model: Model, clientX: number, startWidth: number, maxWidth: number): Return => ({
	model: modifyFields(model, {
		drag: () => ({ startX: clientX, startWidth, maxWidth: Math.max(MIN_WIDTH, maxWidth) }),
	}),
})

/** The panel sits on the right, so moving the edge left widens it. */
const movedEdge = (model: Model, clientX: number): Return => {
	const drag = model.drag
	if (drag === null) return { model }
	const width = clamp(drag.startWidth + drag.startX - clientX, drag.maxWidth)
	return width === model.width ? { model } : { model: modifyFields(model, { width: () => width }) }
}

const releasedEdge = (model: Model): Return => {
	if (model.drag === null) return { model }
	const next = modifyFields(model, { drag: () => null })
	return { model: next, commands: [SaveAssistantPanel({ stored: persisted(next) })] }
}

const nudgedEdge = (model: Model, delta: number, maxWidth: number): Return => {
	const edgeMaxWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, MAX_KEYBOARD_WIDTH))
	const width = clamp(widthOf(model) + delta, edgeMaxWidth)
	if (width === model.width) return { model: modifyFields(model, { edgeMaxWidth: () => edgeMaxWidth }) }
	const next = modifyFields(model, { width: () => width, edgeMaxWidth: () => edgeMaxWidth })
	return { model: next, commands: [SaveAssistantPanel({ stored: persisted(next) })] }
}

// ENGINES

interface StatusFields {
	readonly organizationId: OrganizationId
	readonly connection: Connection
	readonly environmentLabel: string | null
	readonly engines: Engines
}

/** A status answer for the organization on screen (one for another is stale). */
const appliedStatus = (model: Model, status: StatusFields, extra: Partial<Model> = {}): Model =>
	status.organizationId !== model.organizationId
		? model
		: {
				...model,
				connection: status.connection,
				environmentLabel: status.environmentLabel,
				engines: status.engines,
				...extra,
			}

/** The hosted engines with a saved key: what "Use your own API key" offers first is the other one. */
const firstMissingKey = (engines: Engines): Assistant.HostedProvider =>
	engines.anthropic && !engines.openai ? "openai" : "anthropic"

const isEngine = Schema.is(Assistant.Engine)

const submittedKey = (model: Model, inputs: Inputs): Return => {
	const form = model.keyForm
	const organizationId = inputs.shared.organization?.id
	const apiKey = form?.value.trim() ?? ""
	if (form === null || form.isSaving || organizationId === undefined) return { model }
	if (apiKey.length < 8)
		return {
			model: modifyFields(model, {
				keyForm: () => modifyFields(form, { error: () => "Paste the whole key." }),
			}),
		}
	return {
		model: modifyFields(model, {
			keyForm: () => modifyFields(form, { isSaving: () => true, error: () => null }),
		}),
		commands: [SaveAssistantKey({ organizationId, provider: form.provider, apiKey })],
	}
}

const pickedEngine = (model: Model, key: string, inputs: Inputs): Return => {
	if (key === ADD_KEY_KEY) return clickedAddKey(model, firstMissingKey(model.engines))
	const organizationId = inputs.shared.organization?.id
	if (!isEngine(key) || key === model.engines.preferred || organizationId === undefined) return { model }
	return {
		model: modifyFields(model, { isSettingEngine: () => true, error: () => null }),
		commands: [SetAssistantEngine({ organizationId, engine: key })],
	}
}

const clickedAddKey = (model: Model, provider: Assistant.HostedProvider): Return => ({
	model: modifyFields(model, {
		keyForm: () => ({ provider, value: "", isSaving: false, error: null }),
		error: () => null,
	}),
})

const gotEngineMenuMessage = (model: Model, message: Menu.Message, inputs: Inputs): Return => {
	const result = Menu.update(model.engineMenu, message)
	const next = modifyFields(model, { engineMenu: () => result.model })
	const commands = Command.mapMessages(result.commands ?? [], (child) =>
		Message.GotEngineMenuMessage({ message: child }),
	)
	const picked =
		result.outMessage?._tag === "SelectedItem"
			? pickedEngine(next, result.outMessage.key, inputs)
			: { model: next }
	return { ...picked, commands: [...commands, ...(picked.commands ?? [])] }
}

// UPDATE

const gotHistoryMenuMessage = (model: Model, message: Menu.Message): Return => {
	const result = Menu.update(model.historyMenu, message)
	const next = modifyFields(model, { historyMenu: () => result.model })
	const commands = Command.mapMessages(result.commands ?? [], (child) =>
		Message.GotHistoryMenuMessage({ message: child }),
	)
	const picked =
		result.outMessage?._tag === "SelectedItem"
			? pickedHistory(next, result.outMessage.key)
			: { model: next }
	return { ...picked, commands: [...commands, ...(picked.commands ?? [])] }
}

const gotSheetMessage = (model: Model, message: Modal.Message, inputs: Inputs): Return => {
	const result = Modal.update(sheetModelOf(model), message)
	const commands = Command.mapMessages(result.commands ?? [], (child) =>
		Message.GotSheetMessage({ message: child }),
	)
	const closed = !result.model.isOpen && model.isOpen ? close(model, inputs) : { model }
	return { ...closed, commands: [...commands, ...(closed.commands ?? [])] }
}

export const update = (model: Model, message: Message, inputs: Inputs): Return =>
	Message.match<Return>(message, {
		PressedToggle: () => toggle(model, inputs),
		ClickedClose: () => close(model, inputs),
		GotSheetMessage: ({ message }) => gotSheetMessage(model, message, inputs),
		UpdatedThreads: ({ organizationId, threads }) => updatedThreads(model, organizationId, threads),
		UpdatedItems: ({ threadId, items }) =>
			threadId === model.threadId ? { model: updatedItems(model, items) } : { model },
		// An answer for an org the panel has left is stale.
		SucceededFetchStatus: (status) => ({ model: appliedStatus(model, status) }),
		FailedFetchStatus: ({ organizationId }) =>
			organizationId !== model.organizationId
				? { model }
				: { model: modifyFields(model, { connection: () => "Unknown" }) },
		ClickedAddKey: ({ provider }) => clickedAddKey(model, provider),
		PickedKeyProvider: ({ provider }) => ({
			model: modifyFields(model, {
				keyForm: (form) =>
					form === null || form.isSaving ? form : { ...form, provider, error: null },
			}),
		}),
		ChangedKey: ({ value }) => ({
			model: modifyFields(model, {
				keyForm: (form) =>
					form === null ? form : modifyFields(form, { value: () => value, error: () => null }),
			}),
		}),
		SubmittedKey: () => submittedKey(model, inputs),
		CancelledKey: () => ({ model: modifyFields(model, { keyForm: () => null }) }),
		// The key is saved and is the engine new chats use now; the form (and the key) is gone.
		SucceededSaveKey: (status) => ({
			model: appliedStatus(model, status, { keyForm: null }),
			commands: [FocusAssistantComposer()],
		}),
		FailedSaveKey: ({ message }) => ({
			model: modifyFields(model, {
				keyForm: (form) =>
					form === null
						? form
						: modifyFields(form, { isSaving: () => false, error: () => message }),
			}),
		}),
		GotEngineMenuMessage: ({ message }) => gotEngineMenuMessage(model, message, inputs),
		SucceededSetEngine: (status) => ({ model: appliedStatus(model, status, { isSettingEngine: false }) }),
		FailedSetEngine: ({ message }) => ({
			model: modifyFields(model, { isSettingEngine: () => false, error: () => message }),
		}),
		ChangedDraft: ({ value }) => ({ model: changedDraft(model, value) }),
		SubmittedComposer: () => send(model, model.draft, inputs, true),
		ClickedSuggestion: ({ text }) => send(model, text, inputs, false),
		ToggledContext: () => ({
			model: modifyFields(model, { isContextIncluded: (isIncluded) => !isIncluded }),
		}),
		MadeMessageId: ({ messageId }) => madeMessageId(model, messageId, inputs),
		SucceededSend: ({ messageId }) => succeededSend(model, messageId),
		FailedSend: (failed) => failedSend(model, failed),
		ClickedNewChat: () =>
			model.threadId === null
				? { model, commands: [FocusAssistantComposer()] }
				: showThread(model, null),
		GotHistoryMenuMessage: ({ message }) => gotHistoryMenuMessage(model, message),
		ClickedStop: () => clickedStop(model, inputs),
		SucceededStop: () => ({ model: modifyFields(model, { isStopping: () => false }) }),
		// The error belongs to the chat that was stopped: shown only while it is on screen.
		FailedStop: ({ threadId, message }) => ({
			model: modifyFields(model, {
				isStopping: () => false,
				error: (error) => (threadId === model.threadId ? message : error),
			}),
		}),
		ClickedShare: () => clickedShare(model, inputs),
		SucceededUpdateVisibility: () => ({
			model: modifyFields(model, { isUpdatingVisibility: () => false }),
		}),
		FailedUpdateVisibility: ({ message }) => ({
			model: modifyFields(model, { isUpdatingVisibility: () => false, error: () => message }),
		}),
		ToggledWork: ({ key }) => ({
			model: modifyFields(model, {
				expandedWork: (keys) =>
					keys.includes(key) ? keys.filter((current) => current !== key) : [...keys, key],
			}),
		}),
		PickedAnswer: (picked) => ({ model: pickedAnswer(model, picked) }),
		ChangedAnswer: ({ itemId, questionId, value }) => ({
			model: setAnswer(model, itemId, questionId, [value]),
		}),
		SubmittedAnswers: ({ itemId }) => submittedAnswers(model, itemId, inputs),
		// The answer stays in flight until the question syncs as answered (`updatedItems`).
		SucceededAnswer: () => ({ model }),
		FailedAnswer: ({ itemId, message }) => ({
			model: modifyFields(model, {
				answeringItemId: (current) => (current === itemId ? null : current),
				answerError: () => ({ itemId, message }),
			}),
		}),
		PressedEdge: ({ clientX, startWidth, maxWidth }) => pressedEdge(model, clientX, startWidth, maxWidth),
		MovedEdge: ({ clientX }) => movedEdge(model, clientX),
		ReleasedEdge: () => releasedEdge(model),
		NudgedEdge: ({ delta }) => ({
			model,
			commands: [
				MeasureAssistantEdge({
					delta,
					minPageWidth: MIN_PAGE_WIDTH,
					fallbackMaxWidth: MAX_KEYBOARD_WIDTH,
				}),
			],
		}),
		MeasuredNudge: ({ delta, maxWidth }) => nudgedEdge(model, delta, maxWidth),
		CompletedSaveStored: () => ({ model }),
		CompletedFocusComposer: () => ({ model }),
		CompletedFocusToggle: () => ({ model }),
	})
