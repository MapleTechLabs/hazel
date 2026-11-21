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
	SucceededFetchStatus: { connection: Connection, environmentLabel: Schema.NullOr(Schema.String) },
	FailedFetchStatus: {},
	ChangedDraft: { value: Schema.String },
	SubmittedComposer: {},
	ClickedSuggestion: { text: Schema.String },
	ToggledContext: {},
	/** The pending message's id (and a new thread's), made by `MakeAssistantMessageId`. */
	MadeMessageId: { messageId: AssistantItemId },
	SucceededSend: { threadId: AssistantThreadId },
	/** The message is the one to show (the engine's own, or the common copy). */
	FailedSend: { message: Schema.String },
	ClickedNewChat: {},
	GotHistoryMenuMessage: { message: Menu.Message },
	ClickedStop: {},
	SucceededStop: {},
	FailedStop: { message: Schema.String },
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
	SucceededAnswer: {},
	FailedAnswer: { message: Schema.String },
	/** The resize edge was grabbed: the panel's width and the widest the page leaves room for. */
	PressedEdge: { clientX: Schema.Finite, startWidth: Schema.Finite, maxWidth: Schema.Finite },
	MovedEdge: { clientX: Schema.Finite },
	ReleasedEdge: {},
	/** An arrow key on the focused edge, by the px it moves (left widens). */
	NudgedEdge: { delta: Schema.Finite },
	CompletedSaveStored: {},
	CompletedFocusComposer: {},
})
export type Message = typeof Message.Type
