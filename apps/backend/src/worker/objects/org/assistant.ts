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
import {
	makeT3CodeMcpSession,
	type T3CodeMcpSession,
	type T3Item,
	TERMINAL_RUN_STATUSES,
} from "@hazel/integrations/t3code"
import { AssistantItemId, type AssistantThreadId, type OrganizationId, type UserId } from "@hazel/schema"
import { Clock, Effect, Option, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { defineCall } from "../calls"
import { markT3CodeExpired, t3CodeAccess } from "./t3code"

/** One step's `t3_thread_wait`: short, so a step (and the alarm) never runs long. */
export const STEP_WAIT_MS = 20_000
/** While a question waits on the member, check now and then whether it was answered in T3 Code. */
const WAITING_STEP_MS = 30_000
/** An unreachable environment: back off, and give up after this many steps in a row. */
const MAX_FAILURES = 20
const MAX_BACKOFF_MS = 5 * 60_000
/** Steps run at once in one alarm. */
const STEP_CONCURRENCY = 4
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

const itemStatus = (item: T3Item) =>
	isFinal(item) ? (item.status === "failed" ? "failed" : "completed") : "running"

// ============================================================================
// Errors
// ============================================================================

const tagOf = (error: unknown) =>
	typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : ""

/** A failure reaching the owner's environment, as the panel's error. */
export const engineErrorOf = (error: unknown): AssistantEngineError => {
	switch (tagOf(error)) {
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
		default:
			return new AssistantEngineError({
				reason: "refused",
				message:
					error !== null && typeof error === "object" && "message" in error
						? `T3 Code refused: ${String(error.message)}`
						: "T3 Code refused the message.",
			})
	}
}

/** Run a call on the owner's environment; a refused credential marks their link expired. */
const onEnvironment = <A, E, R>(ownerId: UserId, effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.provide(FetchHttpClient.layer),
		Effect.tapError((error) =>
			tagOf(error) === "T3CodeUnauthorizedError" ? markT3CodeExpired({ ownerId }) : Effect.void,
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

const insertUserItem = (
	thread: Pick<schema.AssistantThread, "id" | "organizationId" | "ownerId" | "visibility">,
	text: string,
	now: Date,
) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.insertInto(schema.assistantItemsTable).values({
				id: AssistantItemId.make(crypto.randomUUID()),
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
			}),
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
			yield* insertUserItem(thread, input.message, now)
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
	const itemId = AssistantItemId.make(crypto.randomUUID())
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
			yield* insertUserItem(thread, input.message, now)
			yield* db.run(
				SQLite.update(schema.assistantThreadsTable)
					.set({
						status: "running",
						errorMessage: null,
						lastActivityAt: now,
						updatedAt: now,
						...(input.context === null ? {} : { context: contextRow(input.context) }),
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
	const closeItem = (answers: Record<string, string> | null) =>
		db.run(
			SQLite.update(schema.assistantItemsTable)
				.set({
					data: {
						requestId: question.requestId,
						questions: question.questions.map((q) => ({ ...q })),
						answered: true,
						...(answers === null ? {} : { answers }),
					},
					status: "completed",
					updatedAt: now,
				})
				.where(($) => [$.id.eq(input.itemId)]),
		)
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
						...(input.title === undefined ? {} : { title: input.title }),
						...(visibility === undefined ? {} : { visibility }),
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

/** The alarm's work: step every thread that is due. */
export const AssistantTickCall = defineCall("org.assistantTick", "org", {
	payload: Schema.Struct({}),
	success: Schema.Struct({ stepped: Schema.Finite }),
	error: Schema.Never,
})

export const assistantTick = Effect.fn("Assistant.tick")(function* () {
	const db = yield* Database.Database
	const now = new Date(yield* Clock.currentTimeMillis)
	const due = yield* db
		.run(
			SQLite.from(schema.assistantFollowersTable)
				.select()
				.where(($) => [$.nextStepAt.isNotNull(), $.nextStepAt.lte(now)]),
		)
		.pipe(Effect.orDie)
	yield* Effect.forEach(
		due,
		(follower) =>
			stepThread(follower).pipe(
				Effect.catchCause((cause) =>
					Effect.logError("Assistant step failed", { threadId: follower.threadId, cause }),
				),
			),
		{ concurrency: STEP_CONCURRENCY, discard: true },
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

/** One step of one thread: wait for news, read it, mirror it, decide when to look again. */
const stepThread = Effect.fn("Assistant.step")(function* (follower: schema.AssistantFollower) {
	const db = yield* Database.Database
	const thread = Option.getOrNull(yield* findThread(follower.threadId).pipe(Effect.orDie))
	const startedAt = new Date(yield* Clock.currentTimeMillis)
	if (thread === null || thread.externalThreadId === null) {
		yield* db
			.run(
				SQLite.deleteFrom(schema.assistantFollowersTable).where(($) => [
					$.threadId.eq(follower.threadId),
				]),
			)
			.pipe(Effect.orDie)
		return
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
				? yield* onEnvironment(thread.ownerId, openQuestion(mcp, thread, follower))
				: null
		return { waited, activity, question }
	}).pipe(Effect.result)

	const now = new Date(yield* Clock.currentTimeMillis)
	if (outcome._tag === "Failure") {
		const error = outcome.failure
		if (error.reason === "unreachable" && follower.failures + 1 < MAX_FAILURES) {
			const failures = follower.failures + 1
			const delay = Math.min(MAX_BACKOFF_MS, 15_000 * 2 ** Math.min(failures - 1, 5))
			yield* db
				.run(
					SQLite.update(schema.assistantFollowersTable)
						.set({ failures, nextStepAt: new Date(now.getTime() + delay), updatedAt: now })
						.where(($) => [$.threadId.eq(thread.id)]),
				)
				.pipe(Effect.orDie)
			return
		}
		yield* settle(thread.id, "error", error.message, now).pipe(Effect.orDie)
		return
	}

	const { waited, activity, question } = outcome.success
	const runEnded = waited.status === "idle" || TERMINAL_RUN_STATUSES.has(waited.status)
	const waiting = waited.status === "waiting"
	yield* db
		.transaction(
			Effect.gen(function* () {
				yield* writeItems(thread, activity.items, startedAt)
				yield* db.run(
					SQLite.update(schema.assistantFollowersTable)
						.set({
							cursor: activity.cursor,
							failures: 0,
							updatedAt: now,
							...(question === null ? {} : { pendingQuestion: question }),
						})
						.where(($) => [$.threadId.eq(thread.id)]),
				)
				if (activity.items.length > 0) {
					yield* db.run(
						SQLite.update(schema.assistantThreadsTable)
							.set({ lastActivityAt: now, updatedAt: now })
							.where(($) => [$.id.eq(thread.id)]),
					)
				}
				// A follow-up queued behind the run keeps the thread going.
				if (runEnded && activity.activeRunId === null) {
					const failed = waited.status === "failed"
					yield* settle(
						thread.id,
						failed ? "error" : "idle",
						failed ? "The run failed in T3 Code." : null,
						now,
					)
					return
				}
				const status = waiting ? "waiting" : "running"
				if (thread.status !== status) {
					yield* db.run(
						SQLite.update(schema.assistantThreadsTable)
							.set({ status, errorMessage: null, updatedAt: now })
							.where(($) => [$.id.eq(thread.id)]),
					)
				}
				yield* db.run(
					SQLite.update(schema.assistantFollowersTable)
						.set({ nextStepAt: waiting ? new Date(now.getTime() + WAITING_STEP_MS) : now })
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
			const read = yield* mcp.read({
				threadId: externalThreadId,
				view: "activity",
				...(after === null ? {} : { afterPosition: after }),
				limit: 50,
				maxCharsPerItem: 8000,
			})
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

/** The agent's open question as a `question` item, once per request. */
const openQuestion = (
	mcp: T3CodeMcpSession,
	thread: schema.AssistantThread,
	follower: schema.AssistantFollower,
) =>
	Effect.gen(function* () {
		const externalThreadId = thread.externalThreadId!
		const requestIds = yield* mcp.pendingQuestions(externalThreadId)
		const requestId = requestIds[0]
		if (requestId === undefined || follower.pendingQuestion?.requestId === requestId) return null
		const pending = yield* mcp.readQuestion(externalThreadId, requestId)
		const db = yield* Database.Database
		const now = new Date(yield* Clock.currentTimeMillis)
		const itemId = AssistantItemId.make(crypto.randomUUID())
		yield* db
			.run(
				SQLite.insertInto(schema.assistantItemsTable)
					.values({
						id: itemId,
						threadId: thread.id,
						organizationId: thread.organizationId,
						ownerId: thread.ownerId,
						visibility: thread.visibility,
						kind: "question",
						externalId: `question:${requestId}`,
						runId: null,
						status: "running",
						title: null,
						text: pending.questions.map((q) => q.question).join("\n"),
						data: { requestId, questions: pending.questions.map((q) => ({ ...q })) },
						authorId: null,
						createdAt: now,
						updatedAt: now,
						deletedAt: null,
					})
					.onConflictDoNothing(),
			)
			.pipe(Effect.orDie)
		return { requestId, itemId: itemId as string }
	})

/** Insert the new items and update the changed ones; untouched rows are not written (no sync churn). */
const writeItems = (thread: schema.AssistantThread, items: ReadonlyArray<ReadItem>, base: Date) =>
	Effect.gen(function* () {
		if (items.length === 0) return
		const db = yield* Database.Database
		const externalIds = items.map(({ item }) => item.itemId)
		const existing = yield* db.run(
			SQLite.from(schema.assistantItemsTable)
				.select()
				.where(($) => [$.threadId.eq(thread.id), $.externalId.in_(...externalIds)]),
		)
		const byExternal = new Map(existing.map((row) => [row.externalId, row]))
		let offset = 0
		for (const { item, view } of items) {
			const status = itemStatus(item)
			const row = byExternal.get(item.itemId)
			if (row === undefined) {
				// Read in order: a millisecond apart keeps that order on the client.
				const createdAt = new Date(base.getTime() + offset++)
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
					.set({ text: view.text, status, title: view.title, data: view.data, updatedAt: base })
					.where(($) => [$.id.eq(row.id)]),
			)
		}
	})
