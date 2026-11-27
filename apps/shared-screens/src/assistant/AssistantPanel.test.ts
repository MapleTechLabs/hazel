// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene, Story } from "@effect/ui/testing"
import { AssistantItemId, AssistantThreadId, OrganizationId, UserId } from "@hazel/schema"
import { TextField } from "@hazel/ui/vocabulary/index"
import { describe, expect, test } from "vitest"
import { Navigate } from "../app/requests"
import {
	AnswerQuestion,
	AssistantPanelEvents,
	AssistantPanelMessage as M,
	AssistantPanelNoDeps,
	type AssistantPanelProps,
	FetchStatus,
	FocusComposer,
	GONE_THREAD,
	MakeMessageId,
	SendMessage,
	StartThread,
	StopThread,
	UpdateVisibility,
} from "./AssistantPanel"
import type { ItemRow, ThreadRow } from "./timeline"

/** The AI panel: a chat with the member's T3 Code about the page, its history, questions and runs. */

const uuid = (group: number, n: number) =>
	`${String(group).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = OrganizationId.make(uuid(1, 1))
const ada = UserId.make(uuid(2, 1))
const grace = UserId.make(uuid(2, 2))
const threadId = AssistantThreadId.make(uuid(9, 1))
const itemId = (n: number) => AssistantItemId.make(uuid(10, n))
const context = { label: "#general", path: "/hazel/chat/c1", route: "ChatChannel", entities: [] }

const props: AssistantPanelProps = {
	organizationId,
	userId: ada,
	open: true,
	mobile: false,
	context,
	setupHref: "/hazel/settings/integrations/t3code",
}

const thread = (overrides: Partial<ThreadRow> = {}): ThreadRow => ({
	id: threadId,
	ownerId: ada,
	ownerName: "Ada Lovelace",
	title: "Summarize #general",
	visibility: "private",
	status: "idle",
	errorMessage: null,
	externalLink: null,
	engineLabel: "MacBook Pro",
	lastActivityAtMs: 10,
	...overrides,
})

const item = (n: number, kind: ItemRow["kind"], overrides: Partial<ItemRow> = {}): ItemRow => ({
	id: itemId(n),
	threadId,
	kind,
	status: "completed",
	title: null,
	text: "",
	input: null,
	question: null,
	createdAtMs: n,
	...overrides,
})

const byProp = (tag: string, name: string, value: string): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const button = (label: string) => byProp("button", "label", label)
const composer = Locator.tag("hz:composer")
const typed = (value: string) => ({ value, rev: 1, edit: 0 })

/** Opened, with T3 Code linked: the focus and the status check acknowledged. */
const connected = (overrides: Partial<AssistantPanelProps> = {}) =>
	Scene.start(AssistantPanelNoDeps, { ...props, ...overrides })
		.subscription("opened:true", M.Opened())
		.expectExact(FetchStatus.make({ organizationId }), FocusComposer.make({}))
		.resolve(
			FetchStatus,
			M.SucceededFetchStatus({ connection: "Connected", environmentLabel: "MacBook Pro" }),
		)
		.resolve(FocusComposer, Component.noop)

/** The same, as a story: the Model is readable and messages go straight to `update`. */
const story = () =>
	Story.start(AssistantPanelNoDeps, props)
		.subscription("opened:true", M.Opened())
		.expectExact(FetchStatus.make({ organizationId }), FocusComposer.make({}))
		.resolve(
			FetchStatus,
			M.SucceededFetchStatus({ connection: "Connected", environmentLabel: "MacBook Pro" }),
		)
		.resolve(FocusComposer, Component.noop)

/** On the seeded thread, its rows synced. */
const onThread = (rows: ReadonlyArray<ItemRow>, threadOverrides: Partial<ThreadRow> = {}) =>
	connected()
		.subscription(`threads:"${organizationId}"`, M.UpdatedThreads({ threads: [thread(threadOverrides)] }))
		.fire(byProp("menu", "label", "Chat history"), "select", { id: threadId })
		.expectExact(FocusComposer.make({}))
		.resolve(FocusComposer, Component.noop)
		.subscription(`items:"${threadId}"`, M.UpdatedItems({ threadId, items: rows }))

const storyOnThread = (rows: ReadonlyArray<ItemRow>) =>
	story()
		.send(M.UpdatedThreads({ threads: [thread()] }))
		.send(M.PickedHistoryEntry({ id: threadId }))
		.expectExact(FocusComposer.make({}))
		.resolve(FocusComposer, Component.noop)
		.send(M.UpdatedItems({ threadId, items: rows }))

describe("opening", () => {
	test("checks T3 Code, then offers a new chat with the page's suggestions", () => {
		const s = Scene.start(AssistantPanelNoDeps, props)
		s.expect(byProp("progress", "label", "Checking T3 Code")).toExist()
		connected()
			.expect(button("Summarize this channel"))
			.toExist()
			.expect(byProp("composer", "placeholder", "Ask about #general"))
			.toExist()
	})

	test("an unlinked T3 Code offers its settings, and closes over it on a phone", () => {
		Scene.start(AssistantPanelNoDeps, { ...props, mobile: true })
			.subscription("opened:true", M.Opened())
			.expectExact(FetchStatus.make({ organizationId }), FocusComposer.make({}))
			.resolve(
				FetchStatus,
				M.SucceededFetchStatus({ connection: "NotConnected", environmentLabel: null }),
			)
			.resolve(FocusComposer, Component.noop)
			.expect(byProp("emptyState", "title", "Connect T3 Code"))
			.toExist()
			.fire(button("Open T3 Code settings"), "press")
			.expectExact(Navigate.make({ href: props.setupHref, replace: false }))
			.emitted(AssistantPanelEvents.RequestedClose())
			.resolve(Navigate, Component.noop)
	})

	test("the close button asks the shell to close it", () => {
		connected().fire(button("Close assistant"), "press").emitted(AssistantPanelEvents.RequestedClose())
	})
})

describe("a new chat", () => {
	test("shows the message at once, then starts a thread with the id its message got", () => {
		const s = story()
			.send(M.SubmittedComposer({ payload: typed("What changed?") }))
			.expectExact(MakeMessageId.make({}))
			.resolve(MakeMessageId, M.MadeMessageId({ messageId: itemId(1) }))
			.expectExact(
				StartThread.make({
					organizationId,
					threadId: AssistantThreadId.make(itemId(1)),
					messageId: itemId(1),
					message: "What changed?",
					context,
				}),
			)
		expect(s.model.draft.text).toBe("")
		expect(s.model.pending?.isSending).toBe(true)
		s.resolve(
			StartThread,
			M.SucceededSend({ threadId: AssistantThreadId.make(itemId(1)), messageId: itemId(1) }),
		)
		expect(s.model.pending?.isSending).toBe(false)
	})

	test("a failed start puts the message back, and the same text retries with its ids", () => {
		const newThread = AssistantThreadId.make(itemId(1))
		const s = story()
			.send(M.SubmittedComposer({ payload: typed("Hi") }))
			.expectExact(MakeMessageId.make({}))
			.resolve(MakeMessageId, M.MadeMessageId({ messageId: itemId(1) }))
			.expectExact(StartThread)
			.resolve(
				StartThread,
				M.FailedSend({
					threadId: newThread,
					messageId: itemId(1),
					message: "Offline",
					isRetryable: true,
				}),
			)
		expect(s.model.draft.text).toBe("Hi")
		expect(s.model.error).toBe("Offline")
		expect(s.model.threadId).toBeNull()
		s.send(
			M.SubmittedComposer({ payload: { value: "Hi", rev: 1, edit: s.model.draft.edit } }),
		).expectExact(
			StartThread.make({
				organizationId,
				threadId: newThread,
				messageId: itemId(1),
				message: "Hi",
				context,
			}),
		)
		s.resolve(StartThread, M.SucceededSend({ threadId: newThread, messageId: itemId(1) }))
	})

	test("the context chip turned off sends without context, for that message only", () => {
		const s = story()
			.send(M.PressedContext())
			.send(M.PressedSuggestion({ text: "Summarize this channel" }))
			.expectExact(MakeMessageId.make({}))
		expect(s.model.pending?.context).toBeNull()
		expect(s.model.isContextIncluded).toBe(true)
		s.resolve(MakeMessageId, M.MadeMessageId({ messageId: itemId(2) })).expectExact(StartThread)
		s.resolve(
			StartThread,
			M.SucceededSend({ threadId: AssistantThreadId.make(itemId(2)), messageId: itemId(2) }),
		)
	})

	test("an empty draft sends nothing", () => {
		const s = story().send(M.SubmittedComposer({ payload: typed("   ") }))
		expect(s.model.pending).toBeNull()
	})
})

describe("a thread", () => {
	test("draws thinking and work folded, and the reply's markdown", () => {
		const s = onThread([
			item(1, "user", { text: "Launch?" }),
			item(2, "reasoning", { text: "Reading" }),
			item(3, "tool", { title: "Search", input: "launch" }),
			item(4, "assistant", { text: "Ship on **Thursday**" }),
		])
		expect(s.get(byProp("disclosure", "title", "Thought")).props?.["open"]).toBeUndefined()
		s.expect(byProp("disclosure", "title", "Worked · 1 step")).toExist()
		expect(s.all(Locator.tag("hz:richText")).length).toBeGreaterThan(0)
		s.fire(byProp("disclosure", "title", "Thought"), "toggle", { open: true })
		expect(s.get(byProp("disclosure", "title", "Thought")).props?.["open"]).toBe(true)
	})

	test("a follow-up goes to the open thread with its own message id", () => {
		onThread([item(1, "user", { text: "Launch?" })])
			.fire(composer, "submit", typed("And the docs?"))
			.expectExact(MakeMessageId.make({}))
			.resolve(MakeMessageId, M.MadeMessageId({ messageId: itemId(5) }))
			.expectExact(
				SendMessage.make({
					organizationId,
					threadId,
					messageId: itemId(5),
					message: "And the docs?",
					context,
				}),
			)
			.resolve(SendMessage, M.SucceededSend({ threadId, messageId: itemId(5) }))
	})

	test("the owner shares it and stops a run", () => {
		onThread([], { status: "running" })
			.fire(button("Private. Share with your organization"), "press")
			.expectExact(UpdateVisibility.make({ organizationId, threadId, visibility: "organization" }))
			.resolve(UpdateVisibility, M.SucceededUpdateVisibility())
			.fire(button("Stop"), "press")
			.expectExact(StopThread.make({ organizationId, threadId }))
			.resolve(StopThread, M.SucceededStop())
	})

	test("someone else's shared thread is read only", () => {
		onThread([item(1, "user", { text: "Hi" })], {
			ownerId: grace,
			ownerName: "Grace Hopper",
			visibility: "organization",
		})
			.expect(byProp("item", "title", "Shared by Grace Hopper"))
			.toExist()
			.expect(composer)
			.toBeAbsent()
			.expect(button("Stop"))
			.toBeAbsent()
	})

	test("an open thread that is deleted goes back to a new chat, and says so", () => {
		const s = storyOnThread([]).send(M.UpdatedThreads({ threads: [] }))
		expect(s.model.threadId).toBeNull()
		expect(s.model.error).toBe(GONE_THREAD)
	})
})

describe("questions", () => {
	const asked = item(3, "question", {
		status: "running",
		question: {
			requestId: "r1",
			questions: [
				{ id: "q1", question: "Which day?", options: [{ label: "Thursday" }, { label: "Friday" }] },
				{ id: "q2", question: "Anything else?" },
			],
		},
	})

	test("waits for every answer, then sends them all at once", () => {
		const s = onThread([asked])
		expect(s.get(button("Send answer")).props?.["disabled"]).toBe(true)
		s.fire(byProp("choiceGroup", "label", "Which day?"), "change", { selected: ["Thursday"] }).fire(
			byProp("textArea", "label", "Anything else?"),
			"change",
			{ ...typed("No"), edit: TextField.empty.edit },
		)
		s.fire(button("Send answer"), "press")
			.expectExact(
				AnswerQuestion.make({
					organizationId,
					threadId,
					itemId: itemId(3),
					answers: { q1: "Thursday", q2: "No" },
				}),
			)
			.resolve(AnswerQuestion, M.FailedAnswer({ itemId: itemId(3), message: "Closed" }))
			.expect(byProp("text", "tone", "danger"))
			.toExist()
	})
})
