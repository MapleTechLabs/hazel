import type { Assistant } from "@hazel/domain/models"
import { type AssistantItemId, AssistantThreadId } from "@hazel/schema"
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
	MakeAssistantMessageId,
	SaveAssistantPanel,
	SendAssistantMessage,
	StartAssistantThread,
	StopAssistantThread,
	UpdateAssistantVisibility,
} from "./commands"
import { Message } from "./message"
import {
	HISTORY_MENU_ID,
	type ItemRow,
	type Model,
	NEW_CHAT_KEY,
	PANEL_ID,
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
const MAX_KEYBOARD_WIDTH = 960

export const widthOf = (model: Pick<Model, "width">): number => model.width ?? DEFAULT_WIDTH

const clamp = (width: number, maxWidth: number) => Math.round(Math.max(MIN_WIDTH, Math.min(width, maxWidth)))

// INIT

export const init = (stored: Stored): Model => ({
	isOpen: stored.isOpen,
	width: stored.width === null ? null : clamp(stored.width, MAX_KEYBOARD_WIDTH),
	drag: null,
	organizationId: null,
	threads: [],
	threadId: null,
	items: [],
	connection: "Checking",
	environmentLabel: null,
	draft: "",
	isContextIncluded: true,
	pending: null,
	error: null,
	expandedWork: [],
	answerDrafts: {},
	answeringItemId: null,
	isUpdatingVisibility: false,
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
	const next = modifyFields(model, { isOpen: () => true, error: () => null })
	const organizationId = inputs.shared.organization?.id
	return {
		model: next,
		commands: [
			FocusAssistantComposer(),
			...(organizationId === undefined ? [] : [FetchAssistantStatus({ organizationId })]),
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
	})
	return { model: next, commands: saveCommands(next, inputs.shared) }
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
		error: () => null,
		expandedWork: () => [],
		answerDrafts: () => ({}),
		answeringItemId: () => null,
		isContextIncluded: () => true,
	}),
	commands: [FocusAssistantComposer()],
})

const updatedThreads = (
	model: Model,
	organizationId: NonNullable<Model["organizationId"]>,
	threads: ReadonlyArray<ThreadRow>,
): Return => {
	if (organizationId === model.organizationId)
		return { model: modifyFields(model, { threads: () => threads }) }
	// Another organization: its own threads, and its own T3 Code status.
	const shown = showThread(
		modifyFields(model, {
			organizationId: () => organizationId,
			threads: () => threads,
			draft: () => "",
		}),
		null,
	)
	return {
		model: modifyFields(shown.model, { connection: () => "Checking" }),
		commands: model.isOpen ? [FetchAssistantStatus({ organizationId })] : [],
	}
}

const pickedHistory = (model: Model, key: string): Return => {
	if (key === NEW_CHAT_KEY) return model.threadId === null ? { model } : showThread(model, null)
	const thread = model.threads.find((candidate) => candidate.id === key)
	return thread === undefined || thread.id === model.threadId ? { model } : showThread(model, thread.id)
}

// SENDING

/**
 * Sends `text`: shown at once, then sent once its id is made (`MakeAssistantMessageId`). The draft is
 * cleared only when it is `text`; the page's context goes along unless the member turned it off.
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
	return {
		model: modifyFields(model, {
			draft: (draft) => (isDraft ? "" : draft),
			pending: () => ({
				text: message,
				threadId: model.threadId,
				messageId: null,
				context: model.isContextIncluded ? inputs.context : null,
				isNewThread: model.threadId === null,
				isSending: true,
			}),
			error: () => null,
			isContextIncluded: () => true,
		}),
		commands: [MakeAssistantMessageId()],
	}
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
	return {
		model: modifyFields(model, {
			threadId: () => threadId,
			pending: () => modifyFields(pending, { threadId: () => threadId, messageId: () => messageId }),
		}),
		commands: [
			pending.isNewThread
				? StartAssistantThread({
						organizationId,
						threadId,
						message: pending.text,
						context: pending.context,
					})
				: SendAssistantMessage({
						organizationId,
						threadId,
						messageId,
						message: pending.text,
						context: pending.context,
					}),
		],
	}
}

const succeededSend = (model: Model, threadId: AssistantThreadId): Return => {
	const pending = pendingOf(model)
	// The member moved to another thread meanwhile: theirs has the message once it syncs.
	if (pending === null || pending.threadId !== threadId) return { model }
	return {
		model: reconciled(
			modifyFields(model, { pending: () => modifyFields(pending, { isSending: () => false }) }),
		),
	}
}

/**
 * The message comes back into the composer, unless the member has typed another meanwhile. A
 * thread that never started is left for a new chat.
 */
const failedSend = (model: Model, message: string): Return => {
	const pending = pendingOf(model)
	const isUnstarted = pending?.isNewThread === true && threadOf(model) === null
	return {
		model: modifyFields(model, {
			threadId: (threadId) => (isUnstarted ? null : threadId),
			items: (items) => (isUnstarted ? [] : items),
			draft: (draft) => (draft === "" && pending !== null ? pending.text : draft),
			pending: () => null,
			error: () => message,
		}),
	}
}

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
export const answersOf = (model: Model, item: ItemRow): Record<string, string> | null => {
	const questions = item.question?.questions ?? []
	const drafts = model.answerDrafts[item.id] ?? {}
	const answers = Object.fromEntries(
		questions.map((question) => [question.id, (drafts[question.id] ?? []).join(", ").trim()]),
	)
	return questions.length > 0 && Object.values(answers).every((answer) => answer !== "") ? answers : null
}

const submittedAnswers = (model: Model, itemId: AssistantItemId, inputs: Inputs): Return => {
	const item = model.items.find((candidate) => candidate.id === itemId)
	const organizationId = inputs.shared.organization?.id
	const answers = item === undefined ? null : answersOf(model, item)
	if (
		item === undefined ||
		answers === null ||
		organizationId === undefined ||
		model.answeringItemId !== null ||
		isReadOnly(model, inputs.shared)
	)
		return { model }
	return {
		model: modifyFields(model, { answeringItemId: () => itemId, error: () => null }),
		commands: [AnswerAssistantQuestion({ organizationId, threadId: item.threadId, itemId, answers })],
	}
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

const clickedStop = (model: Model, inputs: Inputs): Return => {
	const own = ownThread(model, inputs)
	return own === null
		? { model }
		: {
				model,
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

const nudgedEdge = (model: Model, delta: number): Return => {
	const width = clamp(widthOf(model) + delta, MAX_KEYBOARD_WIDTH)
	if (width === model.width) return { model }
	const next = modifyFields(model, { width: () => width })
	return { model: next, commands: [SaveAssistantPanel({ stored: persisted(next) })] }
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
			threadId === model.threadId
				? { model: reconciled(modifyFields(model, { items: () => sortItems(items) })) }
				: { model },
		SucceededFetchStatus: ({ connection, environmentLabel }) => ({
			model: modifyFields(model, {
				connection: () => connection,
				environmentLabel: () => environmentLabel,
			}),
		}),
		FailedFetchStatus: () => ({ model: modifyFields(model, { connection: () => "Unknown" }) }),
		ChangedDraft: ({ value }) => ({ model: modifyFields(model, { draft: () => value }) }),
		SubmittedComposer: () => send(model, model.draft, inputs, true),
		ClickedSuggestion: ({ text }) => send(model, text, inputs, false),
		ToggledContext: () => ({
			model: modifyFields(model, { isContextIncluded: (isIncluded) => !isIncluded }),
		}),
		MadeMessageId: ({ messageId }) => madeMessageId(model, messageId, inputs),
		SucceededSend: ({ threadId }) => succeededSend(model, threadId),
		FailedSend: ({ message }) => failedSend(model, message),
		ClickedNewChat: () =>
			model.threadId === null
				? { model, commands: [FocusAssistantComposer()] }
				: showThread(model, null),
		GotHistoryMenuMessage: ({ message }) => gotHistoryMenuMessage(model, message),
		ClickedStop: () => clickedStop(model, inputs),
		SucceededStop: () => ({ model }),
		FailedStop: ({ message }) => ({ model: modifyFields(model, { error: () => message }) }),
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
		SucceededAnswer: () => ({
			model: modifyFields(model, {
				answerDrafts: (drafts) =>
					Object.fromEntries(
						Object.entries(drafts).filter(([itemId]) => itemId !== model.answeringItemId),
					),
				answeringItemId: () => null,
			}),
		}),
		FailedAnswer: ({ message }) => ({
			model: modifyFields(model, { answeringItemId: () => null, error: () => message }),
		}),
		PressedEdge: ({ clientX, startWidth, maxWidth }) => pressedEdge(model, clientX, startWidth, maxWidth),
		MovedEdge: ({ clientX }) => movedEdge(model, clientX),
		ReleasedEdge: () => releasedEdge(model),
		NudgedEdge: ({ delta }) => nudgedEdge(model, delta),
		CompletedSaveStored: () => ({ model }),
		CompletedFocusComposer: () => ({ model }),
	})
