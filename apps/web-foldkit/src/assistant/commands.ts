import { Assistant } from "@hazel/domain/models"
import type { AssistantStatus } from "@hazel/domain/rpc"
import { AssistantItemId, AssistantThreadId, OrganizationId } from "@hazel/schema"
import { Effect, Match, Option, Schema } from "effect"
import { Command } from "foldkit"
import * as Dom from "foldkit/dom"
import { type CommonReason, commonMessage, isRetryableReason } from "~/lib/error-messages"
import { catchCommon } from "../data/actions"
import { readStored, writeStored } from "../data/storage"
import { HazelRpc } from "../rpc"
import { Message } from "./message"
import { COMPOSER_ID, type Connection, type Engines, PANEL_ID, SETUP_ID, Stored, TOGGLE_ID } from "./model"

/** The panel's RPCs, its stored open state and width, and the composer's focus. */

/** One line for an inline error: the common copy's title and description. */
const reasonText = (reason: CommonReason): string => {
	const { title, description } = commonMessage(reason)
	return description === undefined ? title : `${title}. ${description}`
}

const THREAD_GONE = "This chat no longer exists."

/** The engine's own message says what to do (link T3 Code again, open it, ...). */
const writeFailure = <M>(toMessage: (message: string) => M) => ({
	AssistantEngineError: ({ message }: { readonly message: string }) => Effect.succeed(toMessage(message)),
	AssistantThreadNotFoundError: () => Effect.succeed(toMessage(THREAD_GONE)),
})

const target = { organizationId: OrganizationId, threadId: AssistantThreadId }

/** A fresh id for the member's next message (and for the thread it starts: they share it). */
export const MakeAssistantMessageId = Command.define("MakeAssistantMessageId", {
	messages: [Message.MadeMessageId],
	execute: Effect.sync(() =>
		Message.MadeMessageId({ messageId: AssistantItemId.make(crypto.randomUUID()) }),
	),
})

const sendIds = { threadId: AssistantThreadId, messageId: AssistantItemId }
/** A send's ids: its outcome carries them, so a late answer never touches another message. */
type SendIds = Readonly<{ threadId: AssistantThreadId; messageId: AssistantItemId }>

const failedSend = (ids: SendIds, message: string, isRetryable: boolean) =>
	Message.FailedSend({ threadId: ids.threadId, messageId: ids.messageId, message, isRetryable })

/** A new thread, with the id its first message got (the first item's id is the thread's). */
export const StartAssistantThread = Command.define("StartAssistantThread", {
	args: {
		...target,
		messageId: AssistantItemId,
		message: Schema.String,
		context: Schema.NullOr(Assistant.Context),
	},
	messages: [Message.SucceededSend, Message.FailedSend],
	execute: ({ messageId, ...args }) =>
		HazelRpc.use((rpc) => rpc("assistant.start", args)).pipe(
			Effect.as(Message.SucceededSend({ threadId: args.threadId, messageId })),
			Effect.catchTags(
				writeFailure((text) => failedSend({ threadId: args.threadId, messageId }, text, false)),
			),
			catchCommon((reason) =>
				failedSend(
					{ threadId: args.threadId, messageId },
					reasonText(reason),
					isRetryableReason(reason),
				),
			),
		),
})

/** A follow-up; its id makes a retried send a no-op. */
export const SendAssistantMessage = Command.define("SendAssistantMessage", {
	args: {
		...sendIds,
		organizationId: OrganizationId,
		message: Schema.String,
		context: Schema.NullOr(Assistant.Context),
	},
	messages: [Message.SucceededSend, Message.FailedSend],
	execute: (args) =>
		HazelRpc.use((rpc) => rpc("assistant.send", args)).pipe(
			Effect.as(Message.SucceededSend({ threadId: args.threadId, messageId: args.messageId })),
			Effect.catchTags(writeFailure((text) => failedSend(args, text, false))),
			catchCommon((reason) => failedSend(args, reasonText(reason), isRetryableReason(reason))),
		),
})

export const AnswerAssistantQuestion = Command.define("AnswerAssistantQuestion", {
	args: { ...target, itemId: AssistantItemId, answers: Schema.Record(Schema.String, Schema.String) },
	messages: [Message.SucceededAnswer, Message.FailedAnswer],
	execute: (args) =>
		HazelRpc.use((rpc) => rpc("assistant.answer", args)).pipe(
			Effect.as(Message.SucceededAnswer({ itemId: args.itemId })),
			Effect.catchTags({
				...writeFailure((text) => Message.FailedAnswer({ itemId: args.itemId, message: text })),
				AssistantQuestionClosedError: () =>
					Effect.succeed(
						Message.FailedAnswer({
							itemId: args.itemId,
							message: "This question was already answered.",
						}),
					),
			}),
			catchCommon((reason) =>
				Message.FailedAnswer({ itemId: args.itemId, message: reasonText(reason) }),
			),
		),
})

export const StopAssistantThread = Command.define("StopAssistantThread", {
	args: target,
	messages: [Message.SucceededStop, Message.FailedStop],
	execute: (args) =>
		HazelRpc.use((rpc) => rpc("assistant.stop", args)).pipe(
			Effect.as(Message.SucceededStop()),
			Effect.catchTags(
				writeFailure((text) => Message.FailedStop({ threadId: args.threadId, message: text })),
			),
			catchCommon((reason) =>
				Message.FailedStop({ threadId: args.threadId, message: reasonText(reason) }),
			),
		),
})

export const UpdateAssistantVisibility = Command.define("UpdateAssistantVisibility", {
	args: { ...target, visibility: Assistant.Visibility },
	messages: [Message.SucceededUpdateVisibility, Message.FailedUpdateVisibility],
	execute: (args) =>
		HazelRpc.use((rpc) => rpc("assistant.update", args)).pipe(
			Effect.as(Message.SucceededUpdateVisibility()),
			Effect.catchTag("AssistantThreadNotFoundError", () =>
				Effect.succeed(Message.FailedUpdateVisibility({ message: THREAD_GONE })),
			),
			catchCommon((reason) => Message.FailedUpdateVisibility({ message: reasonText(reason) })),
		),
})

/** A new chat can start once any engine is connected; else T3 Code's own state says what to fix. */
const connectionOf = (status: AssistantStatus): Connection =>
	status.preferredEngine !== null
		? "Connected"
		: Match.value(status.t3code.state).pipe(
				Match.when("expired", (): Connection => "Expired"),
				Match.orElse((): Connection => "NotConnected"),
			)

const enginesOf = (status: AssistantStatus): Engines => ({
	preferred: status.preferredEngine,
	t3code: status.t3code.state === "connected",
	anthropic: status.anthropic.state === "connected",
	openai: status.openai.state === "connected",
	anthropicModel: status.anthropic.model,
	openaiModel: status.openai.model,
})

/** What a status answer becomes in the panel. */
const statusFields = (organizationId: OrganizationId, status: AssistantStatus) => ({
	organizationId,
	connection: connectionOf(status),
	environmentLabel: status.t3code.environmentLabel,
	engines: enginesOf(status),
})

/** Which engines the member can use (T3 Code, their own keys); asked each time the panel opens. */
export const FetchAssistantStatus = Command.define("FetchAssistantStatus", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededFetchStatus, Message.FailedFetchStatus],
	execute: (args) =>
		HazelRpc.use((rpc) => rpc("assistant.status", args)).pipe(
			Effect.map((status) => Message.SucceededFetchStatus(statusFields(args.organizationId, status))),
			catchCommon(() => Message.FailedFetchStatus({ organizationId: args.organizationId })),
		),
})

/** Save the member's own API key (the server checks it with the provider first). */
export const SaveAssistantKey = Command.define("SaveAssistantKey", {
	args: { organizationId: OrganizationId, provider: Assistant.HostedProvider, apiKey: Schema.String },
	messages: [Message.SucceededSaveKey, Message.FailedSaveKey],
	execute: (args) =>
		HazelRpc.use((rpc) => rpc("assistant.saveKey", args)).pipe(
			Effect.map((status) => Message.SucceededSaveKey(statusFields(args.organizationId, status))),
			Effect.catchTags({
				AssistantKeyRejectedError: ({ message }) =>
					Effect.succeed(Message.FailedSaveKey({ message })),
				AssistantEngineError: ({ message }) => Effect.succeed(Message.FailedSaveKey({ message })),
			}),
			catchCommon((reason) => Message.FailedSaveKey({ message: reasonText(reason) })),
		),
})

/** The engine new chats start on. */
export const SetAssistantEngine = Command.define("SetAssistantEngine", {
	args: { organizationId: OrganizationId, engine: Assistant.Engine },
	messages: [Message.SucceededSetEngine, Message.FailedSetEngine],
	execute: (args) =>
		HazelRpc.use((rpc) => rpc("assistant.setEngine", args)).pipe(
			Effect.map((status) => Message.SucceededSetEngine(statusFields(args.organizationId, status))),
			Effect.catchTag("AssistantEngineError", ({ message }) =>
				Effect.succeed(Message.FailedSetEngine({ message })),
			),
			catchCommon((reason) => Message.FailedSetEngine({ message: reasonText(reason) })),
		),
})

export const FocusAssistantComposer = Command.define("FocusAssistantComposer", {
	messages: [Message.CompletedFocusComposer],
	// The setup screen has no composer: its link takes focus instead.
	execute: Dom.focus(`#${COMPOSER_ID}`).pipe(
		Effect.catchCause(() => Dom.focus(`#${SETUP_ID}`)),
		Effect.ignoreCause,
		Effect.as(Message.CompletedFocusComposer()),
	),
})

/**
 * Back to the toggle once the panel closed, when focus was in the panel (it is gone now, so focus
 * fell to the page's body); focus the member moved elsewhere stays there.
 */
export const FocusAssistantToggle = Command.define("FocusAssistantToggle", {
	messages: [Message.CompletedFocusToggle],
	execute: Effect.suspend(() => {
		const active = document.activeElement
		const isLost = active === null || active === document.body || active.closest(`#${PANEL_ID}`) !== null
		return isLost ? Dom.focus(`#${TOGGLE_ID}`) : Effect.void
	}).pipe(Effect.ignoreCause, Effect.as(Message.CompletedFocusToggle())),
})

/**
 * An arrow key on the resize edge: measure what the page beside the panel leaves room for (its
 * inset keeps `minPageWidth`), so the width never grows past what is shown.
 */
export const MeasureAssistantEdge = Command.define("MeasureAssistantEdge", {
	args: { delta: Schema.Finite, minPageWidth: Schema.Finite, fallbackMaxWidth: Schema.Finite },
	messages: [Message.MeasuredNudge],
	execute: ({ delta, minPageWidth, fallbackMaxWidth }) =>
		Effect.sync(() => {
			const panel = document.getElementById(PANEL_ID)
			const page = panel?.parentElement?.querySelector('[data-slot="sidebar-inset"]') ?? null
			const maxWidth =
				panel === null || page === null
					? fallbackMaxWidth
					: page.getBoundingClientRect().width + panel.getBoundingClientRect().width - minPageWidth
			return Message.MeasuredNudge({ delta, maxWidth })
		}),
})

// STORAGE

const STORAGE_KEY = "hazel-ai-panel"
const StoredCodec = Schema.toCodecJson(Stored)

export const DEFAULT_STORED: Stored = { isOpen: false, width: null }

/** Read once before the first render (the root's Flags), so an open panel never flashes in. */
export const loadStored: Effect.Effect<Stored> = readStored(STORAGE_KEY, StoredCodec).pipe(
	Effect.map(Option.getOrElse(() => DEFAULT_STORED)),
)

// Best effort: a full or blocked store only forgets the panel.
export const SaveAssistantPanel = Command.define("SaveAssistantPanel", {
	args: { stored: Stored },
	messages: [Message.CompletedSaveStored],
	execute: ({ stored }) =>
		writeStored(STORAGE_KEY, StoredCodec, stored).pipe(
			Effect.ignore,
			Effect.as(Message.CompletedSaveStored()),
		),
})
