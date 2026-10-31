/**
 * Follows one T3 Code thread from its Hazel thread: waits on the T3 run (`t3_thread_wait`, under
 * T3 Connect's idle limit), reads the new activity (`t3_thread_read`) and mirrors it into a live
 * message, one per run: commands, edits and tool calls as steps, reasoning as thinking, the
 * agent's reply as the text. A question the agent asks is posted in the thread (the next reply
 * answers it); an approval cannot be given over MCP, so the owner is pointed at T3 Code.
 */
import type { T3CodeMcpSession, T3Item, T3Question } from "@hazel/integrations/t3code"
import { TERMINAL_RUN_STATUSES } from "@hazel/integrations/t3code"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schedule, Schema } from "effect"

/** A Hazel thread driving a T3 Code thread; kept in the bot's state. */
export const T3Run = Schema.Struct({
	organizationId: Schema.String,
	ownerId: Schema.String,
	threadChannelId: Schema.String,
	t3ThreadId: Schema.String,
	link: Schema.NullOr(Schema.String),
	projectTitle: Schema.String,
	environmentLabel: Schema.String,
	/** Activity read so far: `t3_thread_read`'s `afterPosition`. */
	cursor: Schema.NullOr(Schema.Number),
	/** A question waiting for the next thread reply. */
	pendingQuestion: Schema.NullOr(
		Schema.Struct({ requestId: Schema.String, questionIds: Schema.Array(Schema.String) }),
	),
	/** Approval items already pointed out. */
	notifiedApprovals: Schema.Array(Schema.String),
})
export type T3Run = typeof T3Run.Type

export const ownerOf = (run: T3Run) => run.ownerId as UserId
export const orgOf = (run: T3Run) => run.organizationId as OrganizationId
export const threadOf = (run: T3Run) => run.threadChannelId as ChannelId

/** The live message one run renders into; a subset of the SDK's `StreamSession`. */
export interface LiveMessage {
	readonly setText: (text: string) => Effect.Effect<void, unknown>
	readonly startToolCall: (name: string, input: Record<string, unknown>) => Effect.Effect<string, unknown>
	readonly startThinking: () => Effect.Effect<string, unknown>
	readonly updateStepContent: (
		stepId: string,
		content: string,
		append?: boolean,
	) => Effect.Effect<void, unknown>
	readonly completeStep: (
		stepId: string,
		result?: { output?: unknown; error?: string },
	) => Effect.Effect<void, unknown>
	readonly complete: () => Effect.Effect<void, unknown>
	readonly fail: (error: string) => Effect.Effect<void, unknown>
}

/** What the runner needs from Hazel. */
export interface ChatPort {
	readonly post: (channelId: ChannelId, content: string) => Effect.Effect<void, unknown>
	readonly live: (channelId: ChannelId) => Effect.Effect<LiveMessage, unknown>
	readonly saveRun: (run: T3Run) => Effect.Effect<void, unknown>
}

export type Mcp = Pick<T3CodeMcpSession, "wait" | "read" | "pendingQuestions" | "readQuestion">

const FINAL_ITEM_STATUSES: ReadonlySet<string> = new Set([
	"completed",
	"failed",
	"cancelled",
	"interrupted",
	"idle",
])

const isFinal = (item: T3Item) => item.status == null || FINAL_ITEM_STATUSES.has(item.status)

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

const firstLine = (text: string) => text.split("\n", 1)[0] ?? ""

/** How an activity item shows: a step, thinking, the reply text, or nothing. */
export type ItemView =
	| {
			readonly _tag: "step"
			readonly name: string
			readonly input: Record<string, unknown>
			readonly output: string
	  }
	| { readonly _tag: "thinking"; readonly text: string }
	| { readonly _tag: "reply"; readonly text: string }
	| { readonly _tag: "approval"; readonly text: string }
	| { readonly _tag: "hidden" }

export const viewOf = (item: T3Item): ItemView => {
	const text = item.text ?? ""
	switch (item.type) {
		case "assistant_message":
			return { _tag: "reply", text }
		case "reasoning":
			return text.trim() === "" ? { _tag: "hidden" } : { _tag: "thinking", text: truncate(text, 2000) }
		case "command_execution": {
			// `$ command\noutput`
			const command = firstLine(text).replace(/^\$\s*/, "")
			return {
				_tag: "step",
				name: "Run command",
				input: { command: truncate(command, 300) },
				output: truncate(text.slice(firstLine(text).length + 1), 1500),
			}
		}
		case "file_change":
			return {
				_tag: "step",
				name: "Edit files",
				input: { files: truncate(item.title ?? firstLine(text), 300) },
				output: truncate(text, 1500),
			}
		case "approval_request":
			return { _tag: "approval", text: truncate(text || (item.title ?? "A tool call"), 500) }
		case "user_message":
		case "user_input_request":
		case "proposed_plan":
			return { _tag: "hidden" }
		default:
			return {
				_tag: "step",
				name: item.title ?? item.type.replaceAll("_", " "),
				input: { type: item.type },
				output: truncate(text, 1500),
			}
	}
}

/** A question as a thread message, answered by the next reply. */
export const questionMessage = (questions: ReadonlyArray<T3Question>) =>
	[
		"**T3 Code is asking:**",
		...questions.map((question, index) => {
			const options = (question.options ?? []).map((option) => `  - ${option.label}`).join("\n")
			const prefix = questions.length > 1 ? `${index + 1}. ` : ""
			return `${prefix}${question.question}${options ? `\n${options}` : ""}`
		}),
		questions.length > 1 ? "_Reply with one answer per line._" : "_Reply in this thread to answer._",
	].join("\n")

/** A reply as answers to the pending questions: the whole reply, or one line each. */
export const answersFrom = (questionIds: ReadonlyArray<string>, reply: string) => {
	if (questionIds.length === 1) return { [questionIds[0]!]: reply.trim() }
	const lines = reply
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
	return Object.fromEntries(questionIds.map((id, index) => [id, lines[index] ?? ""]))
}

/** Offline machines come back: retry every 30 seconds for about ten minutes. */
const reconnectSchedule = Schedule.max([Schedule.spaced("30 seconds"), Schedule.recurs(20)])

interface RunRender {
	readonly runId: string
	readonly live: LiveMessage
	readonly steps: Map<string, { readonly stepId: string; done: boolean }>
	reply: string
}

/**
 * Follow the thread until no run is active. Returns when the thread is idle, with the run saved
 * (its cursor and any pending question) for the next follow-up.
 */
export const followThread = Effect.fn("T3Runner.followThread")(function* (input: {
	readonly mcp: Mcp
	readonly chat: ChatPort
	readonly run: T3Run
}) {
	const { mcp, chat } = input
	let run = input.run
	const threadChannelId = threadOf(run)
	let current: RunRender | null = null
	yield* Effect.annotateCurrentSpan({
		"t3.thread_id": run.t3ThreadId,
		"hazel.thread_channel_id": threadChannelId,
	})

	const finishRender = (status: string) =>
		Effect.gen(function* () {
			if (current === null) return
			const render = current
			current = null
			for (const step of render.steps.values()) {
				if (!step.done) yield* render.live.completeStep(step.stepId, {}).pipe(Effect.ignore)
			}
			if (status === "completed") {
				if (render.reply.trim() === "") yield* render.live.setText("_Done._").pipe(Effect.ignore)
				yield* render.live.complete().pipe(Effect.ignore)
			} else {
				yield* render.live
					.fail(`The run ${status === "interrupted" ? "was stopped" : status}.`)
					.pipe(Effect.ignore)
			}
		})

	const renderFor = (runId: string) =>
		Effect.gen(function* () {
			if (current !== null && current.runId === runId) return current
			// A new run (a follow-up that was queued) renders into its own message.
			if (current !== null) yield* finishRender("completed")
			const live = yield* chat.live(threadChannelId)
			const render: RunRender = { runId, live, steps: new Map(), reply: "" }
			current = render
			return render
		})

	const renderItem = (item: T3Item) =>
		Effect.gen(function* () {
			if (item.runId == null) return
			const view = viewOf(item)
			if (view._tag === "hidden") return
			if (view._tag === "approval") {
				if (isFinal(item) || run.notifiedApprovals.includes(item.itemId)) return
				run = { ...run, notifiedApprovals: [...run.notifiedApprovals, item.itemId] }
				yield* chat.post(
					threadChannelId,
					[
						`⏸ **Waiting for approval in T3 Code** on ${run.environmentLabel}: ${view.text}`,
						`@[userId:${run.ownerId}] approve or decline it in T3 Code${run.link ? `: ${run.link}` : "."}`,
					].join("\n"),
				)
				return
			}
			const render = yield* renderFor(item.runId)
			if (view._tag === "reply") {
				if (view.text !== render.reply) {
					render.reply = view.text
					yield* render.live.setText(view.text)
				}
				return
			}
			let step = render.steps.get(item.itemId)
			if (step === undefined) {
				const stepId =
					view._tag === "thinking"
						? yield* render.live.startThinking()
						: yield* render.live.startToolCall(view.name, view.input)
				step = { stepId, done: false }
				render.steps.set(item.itemId, step)
			}
			if (view._tag === "thinking") yield* render.live.updateStepContent(step.stepId, view.text)
			if (isFinal(item) && !step.done) {
				step.done = true
				yield* render.live.completeStep(
					step.stepId,
					item.status === "failed"
						? { error: view._tag === "step" ? view.output || "Failed" : "Failed" }
						: { output: view._tag === "step" ? view.output : undefined },
				)
			}
		})

	/** Read new activity; the cursor stays before the first unfinished item so it is read again. */
	const readActivity = Effect.gen(function* () {
		let after = run.cursor
		let cursor = run.cursor
		let settled = true
		for (let page = 0; page < 20; page++) {
			const read = yield* mcp.read({
				threadId: run.t3ThreadId,
				view: "activity",
				...(after === null ? {} : { afterPosition: after }),
				limit: 50,
				maxCharsPerItem: 4000,
			})
			for (const item of read.items) {
				yield* renderItem(item)
				if (!isFinal(item)) settled = false
				if (settled) cursor = item.position
			}
			if (!read.hasMore || read.nextPosition === null) return { thread: read.thread, cursor }
			after = read.nextPosition
		}
		return { thread: null, cursor }
	})

	const askQuestions = Effect.gen(function* () {
		const requestIds = yield* mcp.pendingQuestions(run.t3ThreadId)
		const requestId = requestIds[0]
		if (requestId === undefined || run.pendingQuestion?.requestId === requestId) return
		const pending = yield* mcp.readQuestion(run.t3ThreadId, requestId)
		run = {
			...run,
			pendingQuestion: { requestId, questionIds: pending.questions.map((question) => question.id) },
		}
		yield* chat.saveRun(run)
		yield* chat.post(threadChannelId, questionMessage(pending.questions))
	})

	let offlineNoticed = false
	const retryOffline = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		effect.pipe(
			Effect.tapError((error) =>
				typeof error === "object" &&
				error !== null &&
				"_tag" in error &&
				error._tag === "T3CodeUnreachableError" &&
				!offlineNoticed
					? Effect.sync(() => {
							offlineNoticed = true
						}).pipe(
							Effect.andThen(
								chat.post(
									threadChannelId,
									`T3 Code on ${run.environmentLabel} is not answering (asleep or offline?). I'll keep trying for a few minutes.`,
								),
							),
							Effect.ignore,
						)
					: Effect.void,
			),
			Effect.retry({
				schedule: reconnectSchedule,
				while: (error) =>
					typeof error === "object" &&
					error !== null &&
					"_tag" in error &&
					error._tag === "T3CodeUnreachableError",
			}),
		)

	for (;;) {
		const waited = yield* retryOffline(mcp.wait({ threadId: run.t3ThreadId }))
		const activity = yield* retryOffline(readActivity)
		run = { ...run, cursor: activity.cursor }
		const done = waited.status === "idle" || TERMINAL_RUN_STATUSES.has(waited.status)
		if (waited.status === "waiting") yield* retryOffline(askQuestions)
		if (done) {
			// A queued follow-up starts as soon as this run ends: keep following it.
			if (activity.thread?.activeRunId != null) continue
			yield* finishRender(waited.status === "idle" ? "completed" : waited.status)
			yield* chat.saveRun(run)
			return run
		}
		yield* chat.saveRun(run)
	}
})
