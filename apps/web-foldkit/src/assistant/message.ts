import { AssistantItemId, AssistantThreadId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Menu from "../ui/menu"
import * as Modal from "../ui/modal"
import { Connection, ItemRow, ThreadRow } from "./model"

export const Message = defineMessageUnion({
	/** The toggle button, the `aiPanel.toggle` hotkey or the command palette. */
	PressedToggle: {},
	ClickedClose: {},
	/** The phone's sheet (its backdrop, Escape and swipe). */
	GotSheetMessage: { message: Modal.Message },
	UpdatedThreads: { organizationId: OrganizationId, threads: Schema.Array(ThreadRow) },
	UpdatedItems: { threadId: AssistantThreadId, items: Schema.Array(ItemRow) },
	SucceededFetchStatus: {
		organizationId: OrganizationId,
		connection: Connection,
		environmentLabel: Schema.NullOr(Schema.String),
	},
	FailedFetchStatus: { organizationId: OrganizationId },
	ChangedDraft: { value: Schema.String },
	SubmittedComposer: {},
	ClickedSuggestion: { text: Schema.String },
	ToggledContext: {},
	/** The pending message's id (and a new thread's), made by `MakeAssistantMessageId`. */
	MadeMessageId: { messageId: AssistantItemId },
	SucceededSend: { threadId: AssistantThreadId, messageId: AssistantItemId },
	/**
	 * `message` is the one to show (the engine's own, or the common copy); `isRetryable`: it failed
	 * in transit, so sending it again reuses its ids.
	 */
	FailedSend: {
		threadId: AssistantThreadId,
		messageId: AssistantItemId,
		message: Schema.String,
		isRetryable: Schema.Boolean,
	},
	ClickedNewChat: {},
	GotHistoryMenuMessage: { message: Menu.Message },
	ClickedStop: {},
	SucceededStop: {},
	FailedStop: { threadId: AssistantThreadId, message: Schema.String },
	ClickedShare: {},
	SucceededUpdateVisibility: {},
	FailedUpdateVisibility: { message: Schema.String },
	/** A work-log row, by its first item's id. */
	ToggledWork: { key: Schema.String },
	PickedAnswer: {
		itemId: AssistantItemId,
		questionId: Schema.String,
		label: Schema.String,
		isMultiSelect: Schema.Boolean,
	},
	ChangedAnswer: { itemId: AssistantItemId, questionId: Schema.String, value: Schema.String },
	SubmittedAnswers: { itemId: AssistantItemId },
	SucceededAnswer: { itemId: AssistantItemId },
	FailedAnswer: { itemId: AssistantItemId, message: Schema.String },
	/** The resize edge was grabbed: the panel's width and the widest the page leaves room for. */
	PressedEdge: { clientX: Schema.Finite, startWidth: Schema.Finite, maxWidth: Schema.Finite },
	MovedEdge: { clientX: Schema.Finite },
	ReleasedEdge: {},
	/** An arrow key on the focused edge, by the px it moves (left widens). */
	NudgedEdge: { delta: Schema.Finite },
	/** An arrow key's nudge, with the widest the page leaves room for now. */
	MeasuredNudge: { delta: Schema.Finite, maxWidth: Schema.Finite },
	CompletedSaveStored: {},
	CompletedFocusComposer: {},
	CompletedFocusToggle: {},
})
export type Message = typeof Message.Type
