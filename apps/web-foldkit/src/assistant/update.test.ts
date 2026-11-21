import type { Assistant } from "@hazel/domain/models"
import { AssistantItemId, AssistantThreadId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { modifyFields } from "foldkit/struct"
import { describe, expect, test } from "vitest"
import type { Shared } from "../page/contract"
import { sharedDefaults } from "../page/test-shared"
import { Message } from "./message"
import type { ItemRow, Model, ThreadRow } from "./model"
import { GONE_THREAD, init, type Inputs, open, pendingOf, update } from "./update"

/** The panel's sending (optimistic, then reconciled by id), failures, sharing and questions. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const ada = Schema.decodeSync(UserId)(uuid(1))
const grace = Schema.decodeSync(UserId)(uuid(2))
const organizationId = Schema.decodeSync(OrganizationId)(uuid(3))
const threadId = Schema.decodeSync(AssistantThreadId)(uuid(10))
const itemId = (n: number) => Schema.decodeSync(AssistantItemId)(uuid(n))

const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: ada,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: null,
	nowMs: 0,
	...sharedDefaults,
}

const context: Assistant.Context = {
	label: "Acme · Billing",
	path: "/hazel/customers/acme?tab=billing",
	route: "CustomerDetail",
	entities: [{ kind: "customer", id: "acme", name: "Acme" }],
}
const inputs: Inputs = { shared, context }

const run = (model: Model, message: Message) => update(model, message, inputs)
const runAll = (model: Model, messages: ReadonlyArray<Message>) =>
	messages.reduce((current, message) => run(current, message).model, model)

const thread = (overrides: Partial<ThreadRow> = {}): ThreadRow => ({
	id: threadId,
	ownerId: ada,
	ownerName: "Ada Lovelace",
	title: "Acme's health",
	visibility: "private",
	status: "idle",
	errorMessage: null,
	externalLink: "https://t3.example/threads/1",
	engineLabel: "MacBook",
	lastActivityAtMs: 1,
	...overrides,
})

const item = (n: number, overrides: Partial<ItemRow> = {}): ItemRow => ({
	id: itemId(n),
	threadId,
	kind: "assistant",
	status: null,
	title: null,
	text: `item ${n}`,
	input: null,
	question: null,
	createdAtMs: n,
	...overrides,
})

const opened = open(init({ isOpen: false, width: null }), inputs).model
/** The panel on Ada's thread, its items synced. */
const onThread = (threads: ReadonlyArray<ThreadRow>, items: ReadonlyArray<ItemRow> = []) =>
	run(
		modifyFields(run(opened, Message.UpdatedThreads({ organizationId, threads })).model, {
			threadId: () => threadId,
		}),
		Message.UpdatedItems({ threadId, items }),
	).model

const commandNames = (result: ReturnType<typeof run>) =>
	(result.commands ?? []).map((command) => command.name)

describe("opening", () => {
	test("focuses the composer, checks T3 Code and remembers the panel open", () => {
		const result = open(init({ isOpen: false, width: null }), inputs)
		expect(result.model.isOpen).toBe(true)
		const names = commandNames(result)
		expect(names).toContain("FocusAssistantComposer")
		expect(names).toContain("FetchAssistantStatus")
		expect(names).toContain("SaveAssistantPanel")
	})

	test("Escape and the close button close it", () => {
		expect(run(opened, Message.ClickedClose()).model.isOpen).toBe(false)
	})
})

describe("a new chat", () => {
	test("shows the message at once, then starts a thread with the id its message got", () => {
		const typed = run(opened, Message.ChangedDraft({ value: "  How is Acme doing?  " })).model
		const submitted = run(typed, Message.SubmittedComposer())
		expect(submitted.model.draft).toBe("")
		expect(pendingOf(submitted.model)).toMatchObject({ text: "How is Acme doing?", isSending: true })
		expect(commandNames(submitted)).toEqual(["MakeAssistantMessageId"])

		const messageId = itemId(10)
		const made = run(submitted.model, Message.MadeMessageId({ messageId }))
		// The thread's id is its first message's.
		expect(made.model.threadId).toBe(threadId)
		expect(made.commands?.map((command) => [command.name, command.args])).toEqual([
			[
				"StartAssistantThread",
				{ organizationId, threadId, messageId, message: "How is Acme doing?", context },
			],
		])

		const sent = run(made.model, Message.SucceededSend({ threadId, messageId }))
		expect(pendingOf(sent.model)).toMatchObject({ messageId, isSending: false })

		// The synced user item with the same id replaces the optimistic one.
		const synced = run(
			sent.model,
			Message.UpdatedItems({
				threadId,
				items: [item(10, { kind: "user", text: "How is Acme doing?" })],
			}),
		)
		expect(synced.model.pending).toBeNull()
	})

	test("a failed start puts the message back in the composer, with the engine's reason", () => {
		const model = runAll(opened, [
			Message.ChangedDraft({ value: "Hello" }),
			Message.SubmittedComposer(),
			Message.MadeMessageId({ messageId: itemId(10) }),
			Message.FailedSend({
				threadId,
				messageId: itemId(10),
				message: "T3 Code is not running on your machine.",
				isRetryable: false,
			}),
		])
		expect(model.draft).toBe("Hello")
		expect(model.error).toBe("T3 Code is not running on your machine.")
		expect(model.pending).toBeNull()
		// The thread never started: back to a new chat.
		expect(model.threadId).toBeNull()
		// The engine refused it: nothing to retry with the same ids.
		expect(model.retry).toBeNull()
	})

	test("a late failure of an abandoned start leaves the member's next message alone", () => {
		// Start A hangs; the member opens a new chat and sends B.
		const model = runAll(opened, [
			Message.ChangedDraft({ value: "A" }),
			Message.SubmittedComposer(),
			Message.MadeMessageId({ messageId: itemId(10) }),
			Message.ClickedNewChat(),
			Message.ChangedDraft({ value: "B" }),
			Message.SubmittedComposer(),
			Message.MadeMessageId({ messageId: itemId(20) }),
		])
		const late = runAll(model, [
			Message.FailedSend({ threadId, messageId: itemId(10), message: "Timed out", isRetryable: true }),
			Message.SucceededSend({ threadId, messageId: itemId(10) }),
		])
		expect(late.pending).toMatchObject({ text: "B", messageId: itemId(20), isSending: true })
		expect(late.draft).toBe("")
		expect(late.error).toBeNull()
	})

	test("a suggestion sends at once and keeps what the member typed", () => {
		const typed = run(opened, Message.ChangedDraft({ value: "half a thought" })).model
		const result = run(typed, Message.ClickedSuggestion({ text: "Summarize this customer's health" }))
		expect(result.model.draft).toBe("half a thought")
		expect(pendingOf(result.model)?.text).toBe("Summarize this customer's health")
	})

	test("the context chip turned off sends without context, for that message only", () => {
		const model = runAll(opened, [
			Message.ToggledContext(),
			Message.ChangedDraft({ value: "Generic question" }),
			Message.SubmittedComposer(),
		])
		expect(model.isContextIncluded).toBe(true)
		const made = run(model, Message.MadeMessageId({ messageId: itemId(10) }))
		expect(made.commands?.[0]?.args).toMatchObject({ context: null })
	})

	test("an empty draft sends nothing", () => {
		const result = run(
			run(opened, Message.ChangedDraft({ value: "   " })).model,
			Message.SubmittedComposer(),
		)
		expect(result.model.pending).toBeNull()
		expect(result.commands ?? []).toEqual([])
	})
})

describe("a follow-up", () => {
	test("is sent to the open thread with its own message id", () => {
		const model = runAll(onThread([thread()]), [
			Message.ChangedDraft({ value: "And their invoices?" }),
			Message.SubmittedComposer(),
		])
		const made = run(model, Message.MadeMessageId({ messageId: itemId(20) }))
		expect(made.commands?.map((command) => [command.name, command.args])).toEqual([
			[
				"SendAssistantMessage",
				{
					organizationId,
					threadId,
					messageId: itemId(20),
					message: "And their invoices?",
					context,
				},
			],
		])
	})

	test("a second send waits while the first is on its way", () => {
		const model = runAll(onThread([thread()]), [
			Message.ChangedDraft({ value: "first" }),
			Message.SubmittedComposer(),
			Message.ChangedDraft({ value: "second" }),
		])
		const result = run(model, Message.SubmittedComposer())
		expect(result.model.draft).toBe("second")
		expect(result.commands ?? []).toEqual([])
	})
})

describe("retrying", () => {
	const failedInTransit = runAll(onThread([thread()]), [
		Message.ChangedDraft({ value: "And their invoices?" }),
		Message.SubmittedComposer(),
		Message.MadeMessageId({ messageId: itemId(20) }),
		Message.FailedSend({
			threadId,
			messageId: itemId(20),
			message: "Connection lost",
			isRetryable: true,
		}),
	])

	test("the same text is sent again with the ids it first went out with", () => {
		expect(failedInTransit.draft).toBe("And their invoices?")
		const result = run(failedInTransit, Message.SubmittedComposer())
		expect(commandNames(result)).not.toContain("MakeAssistantMessageId")
		expect(result.commands?.[0]?.args).toMatchObject({ threadId, messageId: itemId(20) })
		expect(pendingOf(result.model)).toMatchObject({ messageId: itemId(20), isSending: true })
	})

	test("an edited draft is a new message, with a new id", () => {
		const edited = run(
			failedInTransit,
			Message.ChangedDraft({ value: "And their invoices, please?" }),
		).model
		expect(edited.retry).toBeNull()
		expect(commandNames(run(edited, Message.SubmittedComposer()))).toContain("MakeAssistantMessageId")
	})

	test("a new chat's start is retried with the same thread id", () => {
		const model = runAll(opened, [
			Message.ChangedDraft({ value: "Hello" }),
			Message.SubmittedComposer(),
			Message.MadeMessageId({ messageId: itemId(10) }),
			Message.FailedSend({ threadId, messageId: itemId(10), message: "Timed out", isRetryable: true }),
		])
		expect(model.threadId).toBeNull()
		const result = run(model, Message.SubmittedComposer())
		expect(result.commands?.map((command) => [command.name, command.args])).toEqual([
			[
				"StartAssistantThread",
				{ organizationId, threadId, messageId: itemId(10), message: "Hello", context },
			],
		])
	})
})

describe("someone else's shared thread", () => {
	const shared = onThread([
		thread({ ownerId: grace, ownerName: "Grace Hopper", visibility: "organization" }),
	])

	test("is read only: nothing is sent, and it cannot be re-shared or stopped", () => {
		const typed = run(shared, Message.ChangedDraft({ value: "Hi" })).model
		expect(run(typed, Message.SubmittedComposer()).commands ?? []).toEqual([])
		expect(run(shared, Message.ClickedShare()).commands ?? []).toEqual([])
		expect(run(shared, Message.ClickedStop()).commands ?? []).toEqual([])
	})
})

describe("the owner's thread", () => {
	test("Share makes it the organization's", () => {
		const result = run(onThread([thread()]), Message.ClickedShare())
		expect(result.model.isUpdatingVisibility).toBe(true)
		expect(result.commands?.[0]?.args).toEqual({ organizationId, threadId, visibility: "organization" })
	})

	test("Stop stops the running thread, once until it answers", () => {
		const result = run(onThread([thread({ status: "running" })]), Message.ClickedStop())
		expect(commandNames(result)).toEqual(["StopAssistantThread"])
		expect(result.model.isStopping).toBe(true)
		expect(run(result.model, Message.ClickedStop()).commands ?? []).toEqual([])
		const stopped = run(result.model, Message.SucceededStop()).model
		expect(stopped.isStopping).toBe(false)
	})

	test("Stop also ends a run waiting on the member", () => {
		const result = run(onThread([thread({ status: "waiting" })]), Message.ClickedStop())
		expect(commandNames(result)).toEqual(["StopAssistantThread"])
	})

	test("an idle thread has nothing to stop", () => {
		expect(run(onThread([thread()]), Message.ClickedStop()).commands ?? []).toEqual([])
	})
})

describe("questions", () => {
	const question = item(5, {
		kind: "question",
		status: "running",
		question: {
			requestId: "r1",
			questions: [
				{ id: "plan", question: "Which plan?", options: [{ label: "Pro" }, { label: "Team" }] },
				{
					id: "areas",
					question: "Which areas?",
					options: [{ label: "Billing" }, { label: "Usage" }],
					multiSelect: true,
				},
			],
		},
	})
	const asked = onThread([thread({ status: "waiting" })], [question])
	const pick = (questionId: string, label: string, isMultiSelect = false) =>
		Message.PickedAnswer({ itemId: question.id, questionId, label, isMultiSelect })

	test("waits for every question, then answers them all at once", () => {
		const partly = run(asked, pick("plan", "Pro")).model
		expect(run(partly, Message.SubmittedAnswers({ itemId: question.id })).commands ?? []).toEqual([])

		const model = runAll(partly, [pick("areas", "Billing", true), pick("areas", "Usage", true)])
		const result = run(model, Message.SubmittedAnswers({ itemId: question.id }))
		expect(result.model.answeringItemId).toBe(question.id)
		expect(result.commands?.[0]?.args).toEqual({
			organizationId,
			threadId,
			itemId: question.id,
			answers: { plan: "Pro", areas: "Billing, Usage" },
		})
	})

	test("the answer stays in flight, drafts kept, until the question syncs as answered", () => {
		const answering = runAll(asked, [
			pick("plan", "Pro"),
			pick("areas", "Usage", true),
			Message.SubmittedAnswers({ itemId: question.id }),
			Message.SucceededAnswer({ itemId: question.id }),
		])
		expect(answering.answeringItemId).toBe(question.id)
		expect(answering.answerDrafts[question.id]).toEqual({ plan: ["Pro"], areas: ["Usage"] })
		const synced = run(
			answering,
			Message.UpdatedItems({ threadId, items: [{ ...question, status: "completed" }] }),
		).model
		expect(synced.answeringItemId).toBeNull()
		expect(synced.answerDrafts[question.id]).toBeUndefined()
	})

	test("a failed answer is shown on its own question", () => {
		const failed = runAll(asked, [
			pick("plan", "Pro"),
			pick("areas", "Usage", true),
			Message.SubmittedAnswers({ itemId: question.id }),
			Message.FailedAnswer({ itemId: question.id, message: "This question was already answered." }),
		])
		expect(failed.answeringItemId).toBeNull()
		expect(failed.answerError).toEqual({
			itemId: question.id,
			message: "This question was already answered.",
		})
		expect(failed.answerDrafts[question.id]).toEqual({ plan: ["Pro"], areas: ["Usage"] })
	})

	test("a multi-select pick toggles; a single pick replaces", () => {
		const model = runAll(asked, [
			pick("plan", "Pro"),
			pick("plan", "Team"),
			pick("areas", "Billing", true),
			pick("areas", "Billing", true),
		])
		expect(model.answerDrafts[question.id]).toEqual({ plan: ["Team"], areas: [] })
	})
})

describe("organizations", () => {
	test("the first threads after a load only name the organization: nothing resets", () => {
		const loaded = init({ isOpen: true, width: null })
		const typed = runAll(loaded, [Message.ChangedDraft({ value: "Draft" }), Message.SubmittedComposer()])
		const result = run(typed, Message.UpdatedThreads({ organizationId, threads: [] }))
		expect(result.model.organizationId).toBe(organizationId)
		expect(result.model.pending).toMatchObject({ text: "Draft" })
		expect(commandNames(result)).not.toContain("FetchAssistantStatus")
	})

	test("opening the panel in another organization starts a new chat there", () => {
		const other = Schema.decodeSync(OrganizationId)(uuid(4))
		const closed = run(onThread([thread()]), Message.ClickedClose()).model
		const elsewhere: Inputs = {
			...inputs,
			shared: { ...shared, organization: { id: other, name: "Other", slug: "other", logoUrl: null } },
		}
		const reopened = open(closed, elsewhere).model
		expect(reopened.organizationId).toBe(other)
		expect(reopened.threadId).toBeNull()
		expect(reopened.threads).toEqual([])
	})

	test("an open thread that is unshared or deleted goes back to a new chat, and says so", () => {
		const gone = run(
			onThread([thread({ ownerId: grace, visibility: "organization" })]),
			Message.UpdatedThreads({ organizationId, threads: [] }),
		).model
		expect(gone.threadId).toBeNull()
		expect(gone.error).toBe(GONE_THREAD)
	})

	test("the member's own start whose row has not synced yet stays open", () => {
		const starting = runAll(opened, [
			Message.ChangedDraft({ value: "Hello" }),
			Message.SubmittedComposer(),
			Message.MadeMessageId({ messageId: itemId(10) }),
			Message.UpdatedThreads({ organizationId, threads: [] }),
		])
		expect(starting.threadId).toBe(threadId)
		expect(starting.error).toBeNull()
	})

	test("another organization's threads start a new chat and check T3 Code again", () => {
		const other = Schema.decodeSync(OrganizationId)(uuid(4))
		const result = run(
			onThread([thread()]),
			Message.UpdatedThreads({ organizationId: other, threads: [] }),
		)
		expect(result.model.threadId).toBeNull()
		expect(result.model.connection).toBe("Checking")
		expect(commandNames(result)).toEqual(["FetchAssistantStatus"])
	})
})

describe("width", () => {
	test("the edge drags (left widens), then the width is saved", () => {
		const model = runAll(opened, [
			Message.PressedEdge({ clientX: 1000, startWidth: 420, maxWidth: 800 }),
			Message.MovedEdge({ clientX: 900 }),
		])
		expect(model.width).toBe(520)
		const released = run(model, Message.ReleasedEdge())
		expect(commandNames(released)).toEqual(["SaveAssistantPanel"])
	})

	test("arrow keys stop at the minimum", () => {
		expect(run(opened, Message.NudgedEdge({ delta: -500 })).model.width).toBe(320)
	})
})
