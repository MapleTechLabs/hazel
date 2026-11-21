/**
 * The AI panel's engine in the `OrgObject` (`docs/assistant.md`). A thread runs on its owner's
 * linked T3 Code environment: a message launches or continues a T3 Code thread over its MCP
 * server, and the object's alarm follows it (`assistantTick`), one bounded `t3_thread_wait` and
 * an activity read per step, mirroring T3's items into `assistant_items`. Following on the alarm
 * survives eviction; `assistant_followers` holds where each thread was read up to.
 *
 * The agent only advises: its instructions forbid writes, and Hazel never applies anything it
 * suggests. In T3 Code it runs with the owner's own tools, so this is a request, not a sandbox.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { Assistant } from "@hazel/domain/models"
import { AssistantEngineError } from "@hazel/domain/rpc"
import type { T3CodeAccessDeniedError, T3CodeExpiredError, T3CodeNotConnectedError } from "@hazel/domain/http"
import {
	makeT3CodeMcpSession,
	type T3CodeMcpSession,
	type T3CodeProtocolError,
	type T3CodeToolError,
	type T3CodeUnauthorizedError,
	type T3CodeUnreachableError,
	type T3Item,
	type T3Question,
	TERMINAL_RUN_STATUSES,
} from "@hazel/integrations/t3code"
import { AssistantItemId, type AssistantThreadId, type OrganizationId, type UserId } from "@hazel/schema"
import { Clock, Effect, Option, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { defineCall } from "../calls"
import { markT3CodeExpired, t3CodeAccess } from "./t3code"

/** One step's `t3_thread_wait`: short, so an alarm (which also runs the org's other timers) stays short. */
export const STEP_WAIT_MS = 10_000
/** Threads stepped per alarm, at once. */
const STEPS_PER_TICK = 4
/** While a question waits on the member, check now and then whether it was answered in T3 Code. */
const WAITING_STEP_MS = 30_000
/** The run ended but T3 Code has not started the queued one yet. */
const QUEUED_STEP_MS = 2_000
/** A step that cannot reach the environment (or fails): back off, give up after this many in a row. */
const MAX_FAILURES = 20
const MAX_BACKOFF_MS = 5 * 60_000
const READ_PAGES = 20

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)
const firstLine = (text: string) => text.split("\n", 1)[0] ?? ""

// ============================================================================
// The prompt
// ============================================================================

const INSTRUCTIONS = [
	"You are the assistant in Hazel's side panel. Hazel is the member's team chat and customer workspace.",
	"Look things up with Hazel's MCP tools (list_customers, get_customer, read_messages, search_messages, ...).",
	"Only read. Never send, edit, delete or create anything, in Hazel or anywhere else, and do not change files.",
	"When something should change, recommend it plainly (what, where, why); the member decides and applies it.",
	"Answer briefly, in Markdown.",
].join("\n")

const describeContext = (organizationId: OrganizationId, context: Assistant.Context) => {
	const entities = context.entities.map(
		(entity) => `- ${entity.kind} \`${entity.id}\`${entity.name ? ` (${entity.name})` : ""}`,
	)
	return [
		`The member is looking at: ${context.label} (page \`${context.path}\`, organization \`${organizationId}\`).`,
		...(entities.length === 0 ? [] : ["On that page:", ...entities]),
	].join("\n")
}

/**
 * What T3 Code receives: the instructions and context with the first message, the context again
 * when the member has moved to another page since.
 */
export const promptFor = (input: {
	readonly organizationId: OrganizationId
	readonly message: string
	readonly context: Assistant.Context | null
	readonly previousContext: Assistant.Context | null
	readonly isFirst: boolean
}) => {
	const moved =
		input.context !== null &&
		(input.previousContext === null || input.previousContext.path !== input.context.path)
	const parts = [
		...(input.isFirst ? [INSTRUCTIONS] : []),
		...(input.context !== null && (input.isFirst || moved)
			? [describeContext(input.organizationId, input.context)]
			: []),
	]
	return parts.length === 0 ? input.message : `${parts.join("\n\n")}\n\n---\n\n${input.message}`
}

export const titleFor = (message: string) => truncate(firstLine(message.trim()) || "New chat", 80)

// ============================================================================
// T3 Code's items as panel items
// ============================================================================

const FINAL_ITEM_STATUSES: ReadonlySet<string> = new Set([
	"completed",
	"failed",
	"cancelled",
	"interrupted",
	"idle",
])
const isFinal = (item: T3Item) => item.status == null || FINAL_ITEM_STATUSES.has(item.status)

/** How a T3 Code activity item shows in the panel; `null` for what the panel leaves out. */
export interface ItemView {
	readonly kind: Assistant.ItemKind
	readonly title: string | null
	readonly text: string
	readonly data: Record<string, unknown> | null
}

export const viewOf = (item: T3Item): ItemView | null => {
	const text = item.text ?? ""
	switch (item.type) {
		case "assistant_message":
			return { kind: "assistant", title: null, text, data: null }
		case "proposed_plan":
			return { kind: "assistant", title: "Plan", text, data: null }
		case "reasoning":
			return text.trim() === ""
				? null
				: { kind: "reasoning", title: null, text: truncate(text, 4000), data: null }
		case "command_execution": {
			const command = firstLine(text).replace(/^\$\s*/, "")
			return {
				kind: "tool",
				title: "Run command",
				text: truncate(text.slice(firstLine(text).length + 1), 2000),
				data: { input: truncate(command, 300) },
			}
		}
		case "file_change":
			return {
				kind: "tool",
				title: "Edit files",
				text: truncate(text, 2000),
				data: { input: truncate(item.title ?? firstLine(text), 300) },
			}
		case "approval_request":
			return { kind: "approval", title: item.title ?? null, text: truncate(text, 1000), data: null }
		// The member's own messages are Hazel's items; questions come from `t3_pending_request`.
		case "user_message":
		case "user_input_request":
		case "checkpoint":
			return null
		default:
			return {
				kind: "tool",
				title: item.title ?? item.type.replaceAll("_", " "),
				text: truncate(text, 2000),
				data: null,
			}
	}
}

/** An item of a run that is no longer active will not finish: it counts as finished. */
const itemStatus = (item: T3Item, activeRunId: string | null) =>
	!isFinal(item) && item.runId === activeRunId
		? "running"
		: item.status === "failed"
			? "failed"
			: "completed"

// ============================================================================
// Errors
// ============================================================================

/** Every way a call to the owner's environment fails. */
type EnvironmentFailure =
	| T3CodeNotConnectedError
	| T3CodeAccessDeniedError
	| T3CodeExpiredError
	| T3CodeUnauthorizedError
	| T3CodeUnreachableError
	| T3CodeProtocolError
	| T3CodeToolError

/**
 * A failure reaching the owner's environment, as the panel's error. `unreachable` is retried by
 * the follower; a reply Hazel cannot read (a tunnel's error page, a lost session) counts as one.
 * The environment's own response text never reaches the message: it syncs to everyone shared on.
 */
export const engineErrorOf = (error: EnvironmentFailure): AssistantEngineError => {
	switch (error._tag) {
		case "T3CodeNotConnectedError":
		case "T3CodeAccessDeniedError":
			return new AssistantEngineError({
				reason: "not_connected",
				message: "Link T3 Code in Settings → Integrations to use the AI panel.",
			})
		case "T3CodeExpiredError":
		case "T3CodeUnauthorizedError":
			return new AssistantEngineError({
				reason: "expired",
				message: "Your T3 Code sign-in has expired. Reconnect it in Settings → Integrations.",
			})
		case "T3CodeUnreachableError":
			return new AssistantEngineError({
				reason: "unreachable",
				message: "T3 Code is not answering. Is the machine awake and T3 Code running?",
			})
		case "T3CodeProtocolError":
			return new AssistantEngineError({
				reason: "unreachable",
				message: "T3 Code answered something Hazel could not read. Try again in a moment.",
			})
		case "T3CodeToolError":
			return new AssistantEngineError({
				reason: "refused",
				message: `T3 Code refused: ${truncate(error.message, 200)}`,
			})
	}
}

/** Run a call on the owner's environment; a refused credential marks their link expired. */
const onEnvironment = <A, R>(ownerId: UserId, effect: Effect.Effect<A, EnvironmentFailure, R>) =>
	effect.pipe(
		Effect.provide(FetchHttpClient.layer),
		Effect.tapError((error) =>
			error._tag === "T3CodeUnauthorizedError" ? markT3CodeExpired({ ownerId }) : Effect.void,
		),
		Effect.mapError(engineErrorOf),
	)

/** The owner's environment as an MCP session. */
const ownerSession = (ownerId: UserId) =>
	onEnvironment(
		ownerId,
		Effect.gen(function* () {
			const access = yield* t3CodeAccess({ ownerId, actorId: ownerId })
			const mcp = yield* makeT3CodeMcpSession({
				mcpUrl: access.metadata.mcpUrl,
				accessToken: access.accessToken,
			})
			return { mcp, environmentLabel: access.metadata.environmentLabel }
		}),
	)

// ============================================================================
// Rows
// ============================================================================

export const findThread = (threadId: AssistantThreadId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.assistantThreadsTable)
				.select()
				.where(($) => [$.id.eq(threadId), $.deletedAt.isNull()]),
		),
	)

/** Follow the thread from the next alarm on (a new run, an answer). */
const followSoon = (threadId: AssistantThreadId, now: Date) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.insertInto(schema.assistantFollowersTable)
				.values({
					threadId,
					cursor: null,
					pendingQuestion: null,
					nextStepAt: now,
					failures: 0,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: ["threadId"],
					set: SQLite.excluded(["nextStepAt", "failures", "updatedAt"]),
				}),
		),
	)

/** The member's message; its id makes a retried write land once. */
const insertUserItem = (
	thread: Pick<schema.AssistantThread, "id" | "organizationId" | "ownerId" | "visibility">,
	id: AssistantItemId,
	text: string,
	now: Date,
) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.insertInto(schema.assistantItemsTable)
				.values({
					id,
					threadId: thread.id,
					organizationId: thread.organizationId,
					ownerId: thread.ownerId,
					visibility: thread.visibility,
					kind: "user",
					externalId: null,
					runId: null,
					status: null,
					title: null,
					text,
					data: null,
					authorId: thread.ownerId,
					createdAt: now,
					updatedAt: now,
					deletedAt: null,
				})
				.onConflictDoNothing(),
		),
	)

const contextRow = (context: Assistant.Context | null): schema.AssistantContextRow | null =>
	context === null ? null : { ...context, entities: context.entities.map((entity) => ({ ...entity })) }

const decodeContext = Schema.decodeUnknownOption(Assistant.Context)
const storedContext = (thread: schema.AssistantThread) =>
	thread.context === null ? null : Option.getOrNull(decodeContext(thread.context))

// ============================================================================
// The panel's calls (run by `rpc/handlers/assistant.ts`)
// ============================================================================

/** Launch a T3 Code thread for a new panel thread, then record both. */
export const startThread = Effect.fn("Assistant.start")(function* (input: {
	readonly organizationId: OrganizationId
	readonly ownerId: UserId
	readonly threadId: AssistantThreadId
	readonly message: string
	readonly context: Assistant.Context | null
}) {
	const db = yield* Database.Database
	const { mcp, environmentLabel } = yield* ownerSession(input.ownerId)
	const title = titleFor(input.message)
	const launched = yield* onEnvironment(
		input.ownerId,
		mcp.launchThread({
			scratch: true,
			title,
			message: promptFor({ ...input, previousContext: null, isFirst: true }),
			// The panel's thread id: a retried start launches once.
			clientRequestId: input.threadId,
		}),
	)
	const now = new Date(yield* Clock.currentTimeMillis)
	const thread = {
		id: input.threadId,
		organizationId: input.organizationId,
		ownerId: input.ownerId,
		title,
		visibility: "private" as const,
		engine: "t3code" as const,
		status: "running" as const,
		errorMessage: null,
		context: contextRow(input.context),
		externalThreadId: launched.threadId,
		externalLink: launched.link ?? null,
		engineLabel: environmentLabel,
		lastActivityAt: now,
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
	}
	yield* db.transaction(
		Effect.gen(function* () {
			yield* db.run(
				SQLite.insertInto(schema.assistantThreadsTable).values(thread).onConflictDoNothing(),
			)
			// The first message shares the thread's id: two starts in flight write it once.
			yield* insertUserItem(thread, AssistantItemId.make(input.threadId), input.message, now)
			yield* followSoon(thread.id, now)
		}),
	)
	yield* Effect.annotateCurrentSpan({
		"assistant.thread_id": thread.id,
		"t3.thread_id": launched.threadId,
	})
})

/** A follow-up: T3 Code queues it behind a run in progress. */
export const sendMessage = Effect.fn("Assistant.send")(function* (input: {
	readonly organizationId: OrganizationId
	readonly thread: schema.AssistantThread
	/** Made by the client: a retried send reaches T3 Code once and records one item. */
	readonly messageId: AssistantItemId
	readonly message: string
	readonly context: Assistant.Context | null
}) {
	const db = yield* Database.Database
	const { thread } = input
	if (thread.externalThreadId === null) {
		return yield* new AssistantEngineError({
			reason: "refused",
			message: "This chat has no T3 Code thread.",
		})
	}
	const externalThreadId = thread.externalThreadId
	const itemId = input.messageId
	const sent = yield* db.first(
		SQLite.from(schema.assistantItemsTable)
			.select("id")
			.where(($) => [$.id.eq(itemId)]),
	)
	if (Option.isSome(sent)) return
	const { mcp } = yield* ownerSession(thread.ownerId)
	yield* onEnvironment(
		thread.ownerId,
		mcp.send({
			threadId: externalThreadId,
			message: promptFor({
				organizationId: input.organizationId,
				message: input.message,
				context: input.context,
				previousContext: storedContext(thread),
				isFirst: false,
			}),
			clientRequestId: itemId,
		}),
	)
	const now = new Date(yield* Clock.currentTimeMillis)
	yield* db.transaction(
		Effect.gen(function* () {
			yield* insertUserItem(thread, itemId, input.message, now)
			yield* db.run(
				SQLite.update(schema.assistantThreadsTable)
					.set({
						status: "running",
						errorMessage: null,
						lastActivityAt: now,
						updatedAt: now,
						// No context this time: the thread keeps the last one.
						context: input.context === null ? thread.context : contextRow(input.context),
					})
					.where(($) => [$.id.eq(thread.id)]),
			)
			yield* followSoon(thread.id, now)
		}),
	)
})

const QuestionData = Schema.Struct({
	requestId: Schema.String,
	questions: Schema.Array(Assistant.Question),
	answered: Schema.optional(Schema.Boolean),
})

/** Answer the agent's open question. `false` when it is no longer open. */
export const answerQuestion = Effect.fn("Assistant.answer")(function* (input: {
	readonly thread: schema.AssistantThread
	readonly itemId: AssistantItemId
	readonly answers: Record<string, string>
}) {
	const db = yield* Database.Database
	const { thread } = input
	const item = yield* db.first(
		SQLite.from(schema.assistantItemsTable)
			.select()
			.where(($) => [$.id.eq(input.itemId), $.threadId.eq(thread.id), $.kind.eq("question")]),
	)
	const data = Option.flatMap(item, (row) => Schema.decodeUnknownOption(QuestionData)(row.data))
	if (Option.isNone(data) || data.value.answered === true || thread.externalThreadId === null) {
		return false
	}
	const question = data.value
	const externalThreadId = thread.externalThreadId
	const { mcp } = yield* ownerSession(thread.ownerId)
	const open = yield* onEnvironment(thread.ownerId, mcp.pendingQuestions(externalThreadId))
	const now = new Date(yield* Clock.currentTimeMillis)
	const closeItem = (answers: Record<string, string> | null) => {
		const closed = {
			requestId: question.requestId,
			questions: question.questions.map((q) => ({ ...q })),
			answered: true,
		}
		const data = answers === null ? closed : { ...closed, answers }
		return db.run(
			SQLite.update(schema.assistantItemsTable)
				.set({
					data,
					status: "completed",
					updatedAt: now,
				})
				.where(($) => [$.id.eq(input.itemId)]),
		)
	}
	if (!open.includes(question.requestId)) {
		// Answered in T3 Code meanwhile: close it here too.
		yield* closeItem(null)
		return false
	}
	yield* onEnvironment(
		thread.ownerId,
		mcp.answerQuestion(externalThreadId, question.requestId, input.answers),
	)
	yield* db.transaction(
		Effect.gen(function* () {
			yield* closeItem(input.answers)
			yield* db.run(
				SQLite.update(schema.assistantThreadsTable)
					.set({ status: "running", lastActivityAt: now, updatedAt: now })
					.where(($) => [$.id.eq(thread.id)]),
			)
			yield* db.run(
				SQLite.update(schema.assistantFollowersTable)
					.set({ pendingQuestion: null, nextStepAt: now, updatedAt: now })
					.where(($) => [$.threadId.eq(thread.id)]),
			)
		}),
	)
	return true
})

/** Stop the run; the follower records how it ended. */
export const stopThread = Effect.fn("Assistant.stop")(function* (thread: schema.AssistantThread) {
	if (thread.externalThreadId === null) return
	const externalThreadId = thread.externalThreadId
	const { mcp } = yield* ownerSession(thread.ownerId)
	yield* onEnvironment(thread.ownerId, mcp.interrupt(externalThreadId, "Stopped from Hazel"))
	yield* followSoon(thread.id, new Date(yield* Clock.currentTimeMillis))
})

/** Rename or share; items follow the thread's visibility (they sync on their own columns). */
export const updateThread = Effect.fn("Assistant.update")(function* (input: {
	readonly thread: schema.AssistantThread
	readonly title?: string | undefined
	readonly visibility?: Assistant.Visibility | undefined
}) {
	const db = yield* Database.Database
	const now = new Date(yield* Clock.currentTimeMillis)
	const visibility = input.visibility
	yield* db.transaction(
		Effect.gen(function* () {
			yield* db.run(
				SQLite.update(schema.assistantThreadsTable)
					.set({
						updatedAt: now,
						title: input.title ?? input.thread.title,
						visibility: visibility ?? input.thread.visibility,
					})
					.where(($) => [$.id.eq(input.thread.id)]),
			)
			if (visibility !== undefined && visibility !== input.thread.visibility) {
				yield* db.run(
					SQLite.update(schema.assistantItemsTable)
						.set({ visibility })
						.where(($) => [$.threadId.eq(input.thread.id)]),
				)
			}
		}),
	)
})

/** Delete for everyone; a run in progress is left to finish in T3 Code, unfollowed. */
export const deleteThread = Effect.fn("Assistant.delete")(function* (thread: schema.AssistantThread) {
	const db = yield* Database.Database
	const now = new Date(yield* Clock.currentTimeMillis)
	yield* db.transaction(
		Effect.gen(function* () {
			yield* db.run(
				SQLite.update(schema.assistantThreadsTable)
					.set({ deletedAt: now, updatedAt: now })
					.where(($) => [$.id.eq(thread.id)]),
			)
			yield* db.run(
				SQLite.update(schema.assistantItemsTable)
					.set({ deletedAt: now, updatedAt: now })
					.where(($) => [$.threadId.eq(thread.id), $.deletedAt.isNull()]),
			)
			yield* db.run(
				SQLite.deleteFrom(schema.assistantFollowersTable).where(($) => [$.threadId.eq(thread.id)]),
			)
		}),
	)
})

// ============================================================================
// Following (the alarm)
// ============================================================================

/** When the alarm next steps a thread, for the object's one alarm. */
export const assistantDeadlines = Effect.gen(function* () {
	const db = yield* Database.Database
	const next = yield* db.first(
		SQLite.from(schema.assistantFollowersTable)
			.select("nextStepAt")
			.where(($) => [$.nextStepAt.isNotNull()])
			.orderBy(($) => [[$.nextStepAt, "asc"]])
			.limit(1),
	)
	return Option.match(next, {
		onNone: (): Array<number> => [],
		onSome: (row) => (row.nextStepAt === null ? [] : [row.nextStepAt.getTime()]),
	})
}).pipe(
	Effect.catchTag("DatabaseError", (error) =>
		Effect.logWarning("Assistant deadline lookup failed", { error: error.message }).pipe(
			Effect.as<Array<number>>([]),
		),
	),
)

/** The alarm's work: step the threads that are due, the most overdue first. */
export const AssistantTickCall = defineCall("org.assistantTick", "org", {
	payload: Schema.Struct({}),
	success: Schema.Struct({ stepped: Schema.Finite }),
	error: Schema.Never,
})

export const assistantTick = Effect.fn("Assistant.tick")(function* () {
	const db = yield* Database.Database
	const now = new Date(yield* Clock.currentTimeMillis)
	// At most one wait's length per alarm: the rest are due again at once and go next time.
	const due = yield* db
		.run(
			SQLite.from(schema.assistantFollowersTable)
				.select()
				.where(($) => [$.nextStepAt.isNotNull(), $.nextStepAt.lte(now)])
				.orderBy(($) => [[$.nextStepAt, "asc"]])
				.limit(STEPS_PER_TICK),
		)
		.pipe(Effect.orDie)
	yield* Effect.forEach(
		due,
		(follower) =>
			stepThread(follower).pipe(
				// A defect is a failed step too: it backs off and gives up, never loops.
				Effect.catchCause((cause) =>
					Effect.logError("Assistant step failed", { threadId: follower.threadId, cause }).pipe(
						Effect.andThen(failedStep(follower, "Following this chat failed.")),
						Effect.orDie,
					),
				),
			),
		{ concurrency: STEPS_PER_TICK, discard: true },
	)
	return { stepped: due.length }
})

/** Stop following, leaving the thread in `status`. */
const settle = (
	threadId: AssistantThreadId,
	status: Assistant.ThreadStatus,
	errorMessage: string | null,
	now: Date,
) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		yield* db.run(
			SQLite.update(schema.assistantThreadsTable)
				.set({ status, errorMessage, updatedAt: now })
				.where(($) => [$.id.eq(threadId)]),
		)
		yield* db.run(
			SQLite.update(schema.assistantFollowersTable)
				.set({ nextStepAt: null, failures: 0, updatedAt: now })
				.where(($) => [$.threadId.eq(threadId)]),
		)
	})

/** A step that made no progress: try again later, or give up with `message` after too many. */
const failedStep = (follower: schema.AssistantFollower, message: string) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const now = new Date(yield* Clock.currentTimeMillis)
		const failures = follower.failures + 1
		if (failures >= MAX_FAILURES) return yield* settle(follower.threadId, "error", message, now)
		const delay = Math.min(MAX_BACKOFF_MS, 15_000 * 2 ** Math.min(failures - 1, 5))
		yield* db.run(
			SQLite.update(schema.assistantFollowersTable)
				.set({ failures, nextStepAt: new Date(now.getTime() + delay), updatedAt: now })
				.where(($) => [$.threadId.eq(follower.threadId)]),
		)
	})

const unfollow = (threadId: AssistantThreadId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(SQLite.deleteFrom(schema.assistantFollowersTable).where(($) => [$.threadId.eq(threadId)])),
	)

/**
 * One step of one thread: wait for news, read it, then in one transaction mirror it and decide when
 * to look again. The thread and follower are read again inside it: the owner may have shared,
 * deleted or sent a follow-up during the wait.
 */
const stepThread = Effect.fn("Assistant.step")(function* (follower: schema.AssistantFollower) {
	const db = yield* Database.Database
	const thread = Option.getOrNull(yield* findThread(follower.threadId).pipe(Effect.orDie))
	if (thread === null || thread.externalThreadId === null) {
		return yield* unfollow(follower.threadId).pipe(Effect.orDie)
	}
	const externalThreadId = thread.externalThreadId
	yield* Effect.annotateCurrentSpan({
		"assistant.thread_id": thread.id,
		"t3.thread_id": externalThreadId,
	})

	const outcome = yield* Effect.gen(function* () {
		const { mcp } = yield* ownerSession(thread.ownerId)
		const waited = yield* onEnvironment(
			thread.ownerId,
			mcp.wait({ threadId: externalThreadId, timeoutMs: STEP_WAIT_MS }),
		)
		const activity = yield* onEnvironment(
			thread.ownerId,
			readActivity(mcp, externalThreadId, follower.cursor),
		)
		const question =
			waited.status === "waiting"
				? yield* onEnvironment(thread.ownerId, pendingQuestion(mcp, externalThreadId))
				: null
		return { waited, activity, question }
	}).pipe(Effect.result)

	if (outcome._tag === "Failure") {
		const error = outcome.failure
		yield* (
			error.reason === "unreachable"
				? failedStep(follower, error.message)
				: settle(thread.id, "error", error.message, new Date(yield* Clock.currentTimeMillis))
		).pipe(Effect.orDie)
		return
	}

	const { waited, activity, question } = outcome.success
	yield* Effect.annotateCurrentSpan({
		"t3.run_status": waited.status,
		"assistant.items": activity.items.length,
	})
	const runEnded = waited.status === "idle" || TERMINAL_RUN_STATUSES.has(waited.status)
	const waiting = waited.status === "waiting"
	yield* db
		.transaction(
			Effect.gen(function* () {
				const now = new Date(yield* Clock.currentTimeMillis)
				const current = Option.getOrNull(yield* findThread(thread.id))
				const latest = Option.getOrNull(
					yield* db.first(
						SQLite.from(schema.assistantFollowersTable)
							.select()
							.where(($) => [$.threadId.eq(thread.id)]),
					),
				)
				// Deleted during the wait: nothing more is written for it.
				if (current === null || latest === null) return yield* unfollow(thread.id)
				// A follow-up or an answer re-armed the follower during the wait: keep going.
				const rearmed = latest.updatedAt.getTime() !== follower.updatedAt.getTime()

				yield* writeItems(current, activity.items, activity.activeRunId, now)
				const asked =
					question !== null && latest.pendingQuestion?.requestId !== question.requestId
						? yield* insertQuestion(current, question, now)
						: null
				yield* db.run(
					SQLite.update(schema.assistantFollowersTable)
						.set({
							cursor: activity.cursor,
							failures: 0,
							updatedAt: now,
							pendingQuestion: asked ?? latest.pendingQuestion,
						})
						.where(($) => [$.threadId.eq(thread.id)]),
				)
				if (activity.items.length > 0 || asked !== null) {
					yield* db.run(
						SQLite.update(schema.assistantThreadsTable)
							.set({ lastActivityAt: now, updatedAt: now })
							.where(($) => [$.id.eq(thread.id)]),
					)
				}
				if (runEnded && activity.activeRunId === null && !rearmed) {
					const failed = waited.status === "failed"
					return yield* settle(
						thread.id,
						failed ? "error" : "idle",
						failed ? "The run failed in T3 Code." : null,
						now,
					)
				}
				const status = waiting ? "waiting" : "running"
				if (current.status !== status) {
					yield* db.run(
						SQLite.update(schema.assistantThreadsTable)
							.set({ status, errorMessage: null, updatedAt: now })
							.where(($) => [$.id.eq(thread.id)]),
					)
				}
				// Waiting on the member, or a queued run T3 Code has not started: look again a bit later.
				const delay = waiting ? WAITING_STEP_MS : runEnded ? QUEUED_STEP_MS : 0
				yield* db.run(
					SQLite.update(schema.assistantFollowersTable)
						.set({ nextStepAt: new Date(now.getTime() + delay) })
						.where(($) => [$.threadId.eq(thread.id)]),
				)
			}),
		)
		.pipe(Effect.orDie)
})

interface ReadItem {
	readonly item: T3Item
	readonly view: ItemView
}

/**
 * New activity since `from`. The cursor stays before the first unfinished item of the active
 * run, so it is read again until it finishes; an item of a run that ended counts as finished.
 */
const readActivity = (mcp: T3CodeMcpSession, externalThreadId: string, from: number | null) =>
	Effect.gen(function* () {
		let after = from
		let cursor = from
		let settled = true
		let activeRunId: string | null = null
		const items: Array<ReadItem> = []
		for (let page = 0; page < READ_PAGES; page++) {
			const request = {
				threadId: externalThreadId,
				view: "activity" as const,
				limit: 50,
				maxCharsPerItem: 8000,
			}
			const read = yield* mcp.read(after === null ? request : { ...request, afterPosition: after })
			activeRunId = read.thread.activeRunId ?? null
			for (const item of read.items) {
				const view = viewOf(item)
				if (view !== null) items.push({ item, view })
				if (!isFinal(item) && item.runId === activeRunId) settled = false
				if (settled) cursor = item.position
			}
			if (!read.hasMore || read.nextPosition === null) break
			after = read.nextPosition
		}
		return { items, cursor, activeRunId }
	})

interface OpenQuestion {
	readonly requestId: string
	readonly questions: ReadonlyArray<T3Question>
}

/** The agent's first open question, if any. */
const pendingQuestion = (mcp: T3CodeMcpSession, externalThreadId: string) =>
	Effect.gen(function* () {
		const requestId = (yield* mcp.pendingQuestions(externalThreadId))[0]
		if (requestId === undefined) return null
		const pending = yield* mcp.readQuestion(externalThreadId, requestId)
		return { requestId, questions: pending.questions } satisfies OpenQuestion
	})

/** The question as a `question` item, once per request. */
const insertQuestion = (thread: schema.AssistantThread, question: OpenQuestion, now: Date) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const itemId = AssistantItemId.make(crypto.randomUUID())
		yield* db.run(
			SQLite.insertInto(schema.assistantItemsTable)
				.values({
					id: itemId,
					threadId: thread.id,
					organizationId: thread.organizationId,
					ownerId: thread.ownerId,
					visibility: thread.visibility,
					kind: "question",
					externalId: `question:${question.requestId}`,
					runId: null,
					status: "running",
					title: null,
					text: question.questions.map((q) => q.question).join("\n"),
					data: {
						requestId: question.requestId,
						questions: question.questions.map((q) => ({ ...q })),
					},
					authorId: null,
					createdAt: now,
					updatedAt: now,
					deletedAt: null,
				})
				.onConflictDoNothing(),
		)
		return { requestId: question.requestId, itemId: itemId as string }
	})

/** SQLite on Durable Objects binds at most 100 parameters per statement. */
const LOOKUP_BATCH = 90

/**
 * Insert the new items and update the changed ones, as `thread` is now (its visibility); untouched
 * rows are not written (no sync churn). New items are stamped from `now`, a millisecond apart in
 * read order, so they sort after anything the member sent before this step committed.
 */
const writeItems = (
	thread: schema.AssistantThread,
	items: ReadonlyArray<ReadItem>,
	activeRunId: string | null,
	now: Date,
) =>
	Effect.gen(function* () {
		if (items.length === 0) return
		const db = yield* Database.Database
		const externalIds = items.map(({ item }) => item.itemId)
		const byExternal = new Map<string | null, schema.AssistantItem>()
		for (let start = 0; start < externalIds.length; start += LOOKUP_BATCH) {
			const batch = externalIds.slice(start, start + LOOKUP_BATCH)
			const rows = yield* db.run(
				SQLite.from(schema.assistantItemsTable)
					.select()
					.where(($) => [$.threadId.eq(thread.id), $.externalId.in_(...batch)]),
			)
			for (const row of rows) byExternal.set(row.externalId, row)
		}
		let offset = 0
		for (const { item, view } of items) {
			const status = itemStatus(item, activeRunId)
			const row = byExternal.get(item.itemId)
			if (row === undefined) {
				const createdAt = new Date(now.getTime() + offset++)
				yield* db.run(
					SQLite.insertInto(schema.assistantItemsTable)
						.values({
							id: AssistantItemId.make(crypto.randomUUID()),
							threadId: thread.id,
							organizationId: thread.organizationId,
							ownerId: thread.ownerId,
							visibility: thread.visibility,
							kind: view.kind,
							externalId: item.itemId,
							runId: item.runId ?? null,
							status,
							title: view.title,
							text: view.text,
							data: view.data,
							authorId: null,
							createdAt,
							updatedAt: createdAt,
							deletedAt: null,
						})
						.onConflictDoNothing(),
				)
				continue
			}
			if (row.text === view.text && row.status === status && row.title === view.title) continue
			yield* db.run(
				SQLite.update(schema.assistantItemsTable)
					.set({ text: view.text, status, title: view.title, data: view.data, updatedAt: now })
					.where(($) => [$.id.eq(row.id)]),
			)
		}
	})
