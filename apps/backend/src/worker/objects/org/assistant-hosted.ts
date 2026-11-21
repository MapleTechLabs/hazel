/**
 * The AI panel's hosted engines (`anthropic`, `openai`) in the `OrgObject` (`docs/assistant.md`):
 * Hazel runs the agent loop itself, with the thread owner's own API key, `effect/ai`'s
 * `LanguageModel` and Hazel's read-only tool registry (`tools/hazel-read-tools.ts`) as a toolkit.
 * Only read tools exist for the model, so "recommend only" is enforced, not asked for.
 *
 * A turn runs on the object's alarm (`assistantTick`): `assistant.start`/`send` record the message
 * and arm the follower; the alarm runs the turn, so a queued turn survives eviction. While the
 * model streams, the reply is written to its items about every {@link FLUSH_MS} and flushed to the
 * sync sockets mid-alarm through {@link AssistantHost}`.flush` (the runtime binds it to the sync
 * runtime's `flush`), so clients see it as it is generated.
 *
 * `assistant.stop` completes the turn's stop signal ({@link AssistantHost}`.turns`); a turn whose
 * instance was evicted is found by the next instance's tick (its follower still marks a turn,
 * `turnStartedAt`, that no fiber of this instance runs) and marked cut off.
 */
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser } from "@hazel/domain"
import { Assistant } from "@hazel/domain/models"
import { AssistantEngineError, AssistantKeyRejectedError } from "@hazel/domain/rpc"
import { AssistantItemId, type AssistantThreadId, type OrganizationId, type UserId } from "@hazel/schema"
import {
	Cause,
	Clock,
	Context,
	Data,
	Deferred,
	Duration,
	Effect,
	Layer,
	Option,
	Redacted,
	Schema,
	Stream,
} from "effect"
import { AiError, LanguageModel, Prompt, type Response, type Tool, type Toolkit } from "effect/ai"
import { FetchHttpClient, Headers, HttpClient, HttpClientRequest } from "effect/http"
import { hazelReadTools, toAiToolkit } from "../../../tools/hazel-read-tools"
import {
	MemberAccess,
	memberAccessInObject,
	memberAccessViaStubs,
	type ObjectSelf,
} from "../../../tools/member-access"
import type { InvokePrincipal } from "../principal"
import { HOSTED_MODELS, hostedKey } from "./assistant-keys"

/** Text deltas are written (and flushed to clients) at most this often. */
export const FLUSH_MS = 300
/** Model calls per turn: each tool round trip is one. */
const MAX_ITERATIONS = 10
/** No part from the model for this long fails the call. */
const IDLE_TIMEOUT = Duration.seconds(60)
/** One model call's wall-clock limit. */
const ITERATION_TIMEOUT = Duration.minutes(3)
/** A whole turn's; the alarm itself has 15 minutes. */
const TURN_TIMEOUT = Duration.minutes(8)
/** While a turn runs its follower is not due before this: only a cut-off turn outlives it. */
export const TURN_LEASE_MS = 10 * 60_000

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

export const isHosted = (engine: Assistant.Engine): engine is Assistant.HostedProvider =>
	engine === "anthropic" || engine === "openai"

export const providerName = (provider: Assistant.HostedProvider) =>
	provider === "anthropic" ? "Anthropic" : "OpenAI"

// ============================================================================
// Services: the models, and the object's hooks
// ============================================================================

export interface HostedModelsApi {
	/** The provider's `LanguageModel` with the member's key. */
	readonly languageModel: (
		provider: Assistant.HostedProvider,
		apiKey: Redacted.Redacted<string>,
		model: string,
	) => Layer.Layer<LanguageModel.LanguageModel>
	/** A cheap call (the model list) that tells whether the provider takes the key. */
	readonly checkKey: (
		provider: Assistant.HostedProvider,
		apiKey: Redacted.Redacted<string>,
	) => Effect.Effect<void, AssistantKeyRejectedError | AssistantEngineError>
}

const KEY_CHECKS = {
	anthropic: {
		url: "https://api.anthropic.com/v1/models?limit=1",
		header: (key: string) => ["x-api-key", key],
	},
	openai: {
		url: "https://api.openai.com/v1/models",
		header: (key: string) => ["authorization", `Bearer ${key}`],
	},
} satisfies Record<
	Assistant.HostedProvider,
	{ readonly url: string; readonly header: (key: string) => readonly [string, string] }
>

// The provider packages mark their layers unstable (pinned at 4.1.4 in the catalog): Hazel accepts
// that for the hosted engines, and these four lines are the only place it touches them.
const anthropicModel = (apiKey: Redacted.Redacted<string>, model: string) => {
	// @effect-diagnostics-next-line unstableApiUsage:off
	const client = AnthropicClient.layer({ apiKey })
	// @effect-diagnostics-next-line unstableApiUsage:off
	const languageModel = AnthropicLanguageModel.layer({
		model,
		config: {
			max_tokens: 16_000,
			// Summarized thinking streams as `reasoning` items; the default would be a silent pause.
			thinking: { type: "adaptive", display: "summarized" },
			output_config: { effort: "medium" },
		},
	})
	return languageModel.pipe(Layer.provide(client), Layer.provide(FetchHttpClient.layer))
}

const openAiModel = (apiKey: Redacted.Redacted<string>, model: string) => {
	// @effect-diagnostics-next-line unstableApiUsage:off
	const client = OpenAiClient.layer({ apiKey })
	// @effect-diagnostics-next-line unstableApiUsage:off
	const languageModel = OpenAiLanguageModel.layer({ model })
	return languageModel.pipe(Layer.provide(client), Layer.provide(FetchHttpClient.layer))
}

/** The real providers, over `fetch`. */
const liveHostedModels: HostedModelsApi = {
	languageModel: (provider, apiKey, model) =>
		provider === "anthropic" ? anthropicModel(apiKey, model) : openAiModel(apiKey, model),
	checkKey: (provider, apiKey) =>
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient
			const check = KEY_CHECKS[provider]
			const [name, value] = check.header(Redacted.value(apiKey))
			const response = yield* client.execute(
				HttpClientRequest.get(check.url).pipe(
					HttpClientRequest.setHeader(name, value),
					HttpClientRequest.setHeader("anthropic-version", "2023-06-01"),
				),
			)
			if (response.status === 401 || response.status === 403) {
				return yield* new AssistantKeyRejectedError({
					provider,
					message: `${providerName(provider)} did not accept this key.`,
				})
			}
			if (response.status >= 400) {
				return yield* new AssistantEngineError({
					reason: "unreachable",
					message: `${providerName(provider)} answered ${response.status}. Try again in a moment.`,
				})
			}
		}).pipe(
			Effect.catchTag("HttpClientError", () =>
				Effect.fail(
					new AssistantEngineError({
						reason: "unreachable",
						message: `${providerName(provider)} could not be reached. Try again in a moment.`,
					}),
				),
			),
			// The key header stays out of spans and logs.
			Effect.updateService(Headers.CurrentRedactedNames, (names) => [...names, "x-api-key"]),
			Effect.provide(FetchHttpClient.layer),
			Effect.withSpan("Assistant.checkKey", { attributes: { "assistant.provider": provider } }),
		),
}

/** The models the hosted engines call; tests provide a fake one. */
export const HostedModels = Context.Reference<HostedModelsApi>("@hazel/backend/HostedModels", {
	defaultValue: () => liveHostedModels,
})

/** A hosted turn running in this instance: how to stop it. */
export interface RunningTurn {
	readonly stop: Effect.Effect<void>
}

/**
 * What the object runtime lends the AI panel (`worker/objects/runtime.ts` binds it per instance):
 * the turns it runs, the mid-run flush to the sync sockets, and its own calls run in process.
 * Outside an object it is inert.
 */
export interface AssistantHostState {
	readonly turns: Map<string, RunningTurn>
	/** Broadcast what was committed so far (`sync.flush`), mid-alarm. */
	flush: Effect.Effect<void>
	/** The object's own calls and RPCs, in process; null outside an object. */
	self: ObjectSelf | null
}

export const makeAssistantHost = (): AssistantHostState => ({
	turns: new Map(),
	flush: Effect.void,
	self: null,
})

export const AssistantHost = Context.Reference<AssistantHostState>("@hazel/backend/AssistantHost", {
	defaultValue: makeAssistantHost,
})

// ============================================================================
// The prompt
// ============================================================================

const SYSTEM = [
	"You are the assistant in Hazel's side panel. Hazel is the member's team chat and customer workspace.",
	"Look things up with your tools (list_customers, get_customer, read_messages, search_messages, ...). They act as the member, with exactly their access, and only read.",
	"You cannot send, edit, delete or create anything. When something should change, recommend it plainly (what, where, why); the member decides and applies it.",
	"Answer briefly, in Markdown.",
].join("\n")

const describeContext = (organizationId: OrganizationId, context: Assistant.Context | null) => {
	const org = `The organization is \`${organizationId}\` (pass it as organization_id).`
	if (context === null) return org
	const entities = context.entities.map(
		(entity) => `- ${entity.kind} \`${entity.id}\`${entity.name ? ` (${entity.name})` : ""}`,
	)
	return [
		org,
		`The member is looking at: ${context.label} (page \`${context.path}\`).`,
		...(entities.length === 0 ? [] : ["On that page:", ...entities]),
	].join("\n")
}

const decodeContext = Schema.decodeUnknownOption(Assistant.Context)

/**
 * The conversation so far, from the thread's items: the member's messages and the assistant's
 * replies (tool steps and reasoning are not replayed). Same-role neighbours are joined.
 */
export const promptOf = (thread: schema.AssistantThread, items: ReadonlyArray<schema.AssistantItem>) => {
	const context = thread.context === null ? null : Option.getOrNull(decodeContext(thread.context))
	const messages: Array<{ role: "user" | "assistant"; content: string }> = []
	for (const item of items) {
		const role = item.kind === "user" ? "user" : item.kind === "assistant" ? "assistant" : null
		if (role === null || item.text.trim() === "") continue
		const last = messages[messages.length - 1]
		if (last !== undefined && last.role === role) last.content = `${last.content}\n\n${item.text}`
		else messages.push({ role, content: item.text })
	}
	return Prompt.make([
		{ role: "system", content: `${SYSTEM}\n\n${describeContext(thread.organizationId, context)}` },
		...messages,
	])
}

// ============================================================================
// The loop (after `bots/hazel-bot/src/agent-loop.ts`)
// ============================================================================

class StreamIdleError extends Data.TaggedError("StreamIdleError")<{}> {}
class IterationTimeoutError extends Data.TaggedError("IterationTimeoutError")<{}> {}
class DegenerateOutputError extends Data.TaggedError("DegenerateOutputError")<{ readonly pattern: string }> {}

type LoopError = AiError.AiError | StreamIdleError | IterationTimeoutError | DegenerateOutputError

/** A short substring repeated 8+ times at the tail of the reply: the model is stuck. */
const repetitionIn = (window: string): string | null => {
	for (let length = 2; length <= 10; length++) {
		if (window.length < length * 8) continue
		const pattern = window.slice(-length)
		let repeats = 1
		let at = window.length - length * 2
		while (at >= 0 && window.slice(at, at + length) === pattern) {
			repeats++
			at -= length
		}
		if (repeats >= 8) return pattern
	}
	return null
}

interface Usage {
	inputTokens: number
	outputTokens: number
}

/**
 * Call the model, run the tools it asks for (the toolkit resolves them), and call it again with
 * the results, until it answers without tools or {@link MAX_ITERATIONS}. Every part goes to
 * `onPart` as it arrives.
 */
const runLoop = (input: {
	readonly prompt: Prompt.Prompt
	readonly toolkit: Toolkit.WithHandler<Record<string, Tool.Any>>
	readonly provider: Assistant.HostedProvider
	readonly model: string
	readonly onPart: (part: Response.AnyPart) => Effect.Effect<void>
}) =>
	Effect.gen(function* () {
		const usage: Usage = { inputTokens: 0, outputTokens: 0 }
		let prompt = input.prompt
		for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
			const parts: Array<Response.AnyPart> = []
			let window = ""
			yield* LanguageModel.streamText({ prompt, toolkit: input.toolkit }).pipe(
				Stream.timeout(IDLE_TIMEOUT),
				Stream.runForEach((part) =>
					Effect.gen(function* () {
						const anyPart = part as Response.AnyPart
						parts.push(anyPart)
						if (anyPart.type === "text-delta") {
							window = (window + anyPart.delta).slice(-200)
							const pattern = repetitionIn(window)
							if (pattern !== null) return yield* new DegenerateOutputError({ pattern })
						}
						if (anyPart.type === "finish") {
							const call = anyPart.usage
							usage.inputTokens += call.inputTokens.total ?? 0
							usage.outputTokens += call.outputTokens.total ?? 0
							yield* Effect.annotateCurrentSpan({
								"gen_ai.usage.input_tokens": call.inputTokens.total ?? 0,
								"gen_ai.usage.output_tokens": call.outputTokens.total ?? 0,
								"gen_ai.response.finish_reason": anyPart.reason,
							})
						}
						yield* input.onPart(anyPart)
					}),
				),
				Effect.timeoutOrElse({
					duration: ITERATION_TIMEOUT,
					orElse: () => Effect.fail(new IterationTimeoutError()),
				}),
				Effect.withSpan("Assistant.modelCall", {
					attributes: {
						"gen_ai.system": input.provider,
						"gen_ai.request.model": input.model,
						"assistant.iteration": iteration,
					},
				}),
			)
			// `Stream.timeout` ends the stream quietly: a call that never finished went idle.
			if (!parts.some((part) => part.type === "finish")) return yield* new StreamIdleError()
			if (!parts.some((part) => part.type === "tool-call")) break
			prompt = Prompt.concat(prompt, Prompt.fromResponseParts(parts))
		}
		return usage
	}) as Effect.Effect<Usage, LoopError, LanguageModel.LanguageModel>

/** What the member reads when a turn fails: never the provider's own text, which syncs to the org. */
const failureMessage = (provider: Assistant.HostedProvider, error: LoopError): string => {
	const name = providerName(provider)
	switch (error._tag) {
		case "StreamIdleError":
			return `${name} stopped answering. Send your message again.`
		case "IterationTimeoutError":
			return `${name} took too long to answer. Send your message again.`
		case "DegenerateOutputError":
			return "The reply started repeating itself and was stopped. Try asking differently."
		case "AiError":
			switch (error.reason._tag) {
				case "AuthenticationError":
					return `${name} refused your API key. Save a new one in the AI panel.`
				case "RateLimitError":
					return `${name} is rate limiting your key. Try again in a moment.`
				case "QuotaExhaustedError":
					return `Your ${name} account is out of credit.`
				case "ContentPolicyError":
					return `${name} declined to answer this.`
				case "NetworkError":
				case "InternalProviderError":
					return `${name} could not be reached. Try again in a moment.`
				default:
					return `${name} failed to answer. Try again in a moment.`
			}
	}
}

// ============================================================================
// Items: the reply as it streams
// ============================================================================

/** `{ a: 1, b: "x" }` → `a: 1, b: x`. */
export const inputLine = (input: unknown): string | null => {
	if (input === undefined || input === null) return null
	if (typeof input !== "object") return truncate(String(input), 300)
	const pairs = Object.entries(input).map(
		([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
	)
	return pairs.length === 0 ? null : truncate(pairs.join(", "), 300)
}

const outputText = (output: unknown) =>
	output === undefined || output === null
		? ""
		: truncate(typeof output === "string" ? output : JSON.stringify(output, null, 2), 2000)

interface OpenItem {
	readonly id: AssistantItemId
	text: string
	written: string
}

/** The text and thinking blocks being streamed now, one of each at most. */
interface OpenBlocks {
	assistant: OpenItem | null
	reasoning: OpenItem | null
}

/**
 * Writes a turn's parts as items: an `assistant` item per text block, a `reasoning` item per
 * thinking block, a `tool` item per call. Text is written at most every {@link FLUSH_MS};
 * a new item, a tool call or a result is written at once; each write is flushed to the sockets.
 */
const makeWriter = (input: {
	readonly threadId: AssistantThreadId
	readonly runId: string
	readonly toolTitle: (name: string) => string
}) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const host = yield* AssistantHost
		let lastCreatedAt = 0
		let lastFlushAt = 0
		const open: OpenBlocks = { assistant: null, reasoning: null }
		const tools = new Map<string, AssistantItemId>()

		const now = Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms))
		const flush = Effect.gen(function* () {
			lastFlushAt = yield* Clock.currentTimeMillis
			yield* host.flush
		})

		const insert = (item: {
			readonly kind: Assistant.ItemKind
			readonly status: string
			readonly title: string | null
			readonly text: string
			readonly data: Record<string, unknown> | null
		}) =>
			Effect.gen(function* () {
				const at = yield* now
				// A millisecond apart at least, in arrival order.
				const createdAt = new Date(Math.max(at.getTime(), lastCreatedAt + 1))
				lastCreatedAt = createdAt.getTime()
				const thread = yield* db.first(
					SQLite.from(schema.assistantThreadsTable)
						.select()
						.where(($) => [$.id.eq(input.threadId)]),
				)
				const row = Option.getOrNull(thread)
				if (row === null) return AssistantItemId.make(crypto.randomUUID())
				const id = AssistantItemId.make(crypto.randomUUID())
				yield* db.run(
					SQLite.insertInto(schema.assistantItemsTable).values({
						id,
						threadId: row.id,
						organizationId: row.organizationId,
						ownerId: row.ownerId,
						visibility: row.visibility,
						kind: item.kind,
						externalId: null,
						runId: input.runId,
						status: item.status,
						title: item.title,
						text: item.text,
						data: item.data,
						authorId: null,
						createdAt,
						updatedAt: createdAt,
						// Deleted while the turn ran: written deleted, so it never shows.
						deletedAt: row.deletedAt,
					}),
				)
				return id
			})

		const update = (
			id: AssistantItemId,
			set: { readonly text?: string; readonly status?: string; readonly title?: string },
		) =>
			Effect.flatMap(now, (at) =>
				db.run(
					SQLite.update(schema.assistantItemsTable)
						.set({ ...set, updatedAt: at })
						.where(($) => [$.id.eq(id)]),
				),
			)

		const writeText = (item: OpenItem, kind: "assistant" | "reasoning") =>
			Effect.gen(function* () {
				const text = kind === "reasoning" ? truncate(item.text, 4000) : item.text
				if (text === item.written) return
				item.written = text
				yield* update(item.id, { text })
			})

		const writeOpen = Effect.gen(function* () {
			if (open.assistant !== null) yield* writeText(open.assistant, "assistant")
			if (open.reasoning !== null) yield* writeText(open.reasoning, "reasoning")
		})

		const close = (kind: "assistant" | "reasoning", status: string) =>
			Effect.gen(function* () {
				const item = open[kind]
				if (item === null) return
				open[kind] = null
				yield* writeText(item, kind)
				yield* update(item.id, { status })
			})

		const delta = (kind: "assistant" | "reasoning", text: string) =>
			Effect.gen(function* () {
				let item = open[kind]
				if (item === null) {
					// A new block: the other kind's block ended.
					yield* close(kind === "assistant" ? "reasoning" : "assistant", "completed")
					const id = yield* insert({ kind, status: "running", title: null, text: "", data: null })
					item = { id, text: "", written: "" }
					open[kind] = item
					item.text += text
					yield* writeText(item, kind)
					return yield* flush
				}
				item.text += text
				if ((yield* Clock.currentTimeMillis) - lastFlushAt < FLUSH_MS) return
				yield* writeOpen
				yield* flush
			})

		const onPart = (part: Response.AnyPart): Effect.Effect<void> =>
			Effect.gen(function* () {
				switch (part.type) {
					case "text-delta":
						return yield* delta("assistant", part.delta)
					case "reasoning-delta":
						return yield* delta("reasoning", part.delta)
					case "text-end":
						yield* close("assistant", "completed")
						return yield* flush
					case "reasoning-end":
						yield* close("reasoning", "completed")
						return yield* flush
					case "tool-call": {
						yield* close("assistant", "completed")
						yield* close("reasoning", "completed")
						const line = inputLine(part.params)
						const id = yield* insert({
							kind: "tool",
							status: "running",
							title: input.toolTitle(part.name),
							text: "",
							data: line === null ? null : { input: line },
						})
						tools.set(part.id, id)
						return yield* flush
					}
					case "tool-result": {
						if (part.preliminary === true) return
						const id = tools.get(part.id)
						if (id === undefined) return
						tools.delete(part.id)
						yield* update(id, {
							status: part.isFailure ? "failed" : "completed",
							text: outputText(part.isFailure ? describeFailure(part.result) : part.result),
						})
						return yield* flush
					}
					default:
						return
				}
			}).pipe(Effect.orDie)

		/** End the turn's items: what is still open ends as `status`, unfinished tools as failed. */
		const finish = (status: "completed" | "failed", toolNote: string) =>
			Effect.gen(function* () {
				yield* close("assistant", status)
				yield* close("reasoning", "completed")
				for (const id of tools.values()) yield* update(id, { status: "failed", text: toolNote })
				tools.clear()
				yield* flush
			}).pipe(Effect.orDie)

		return { onPart, finish }
	})

/** A failed tool's result: the handler's message, or the toolkit's own error. */
const describeFailure = (result: unknown): string => {
	if (typeof result === "string") return result
	if (AiError.isAiError(result)) return result.reason.message
	return "The tool failed"
}

// ============================================================================
// A turn
// ============================================================================

/** The thread owner as a principal: their user row (the org's copy), if they are still a member. */
const ownerPrincipal = (organizationId: OrganizationId, ownerId: UserId) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const member = yield* db.first(
			SQLite.from(schema.organizationMembersTable)
				.select("id")
				.where(($) => [
					$.organizationId.eq(organizationId),
					$.userId.eq(ownerId),
					$.deletedAt.isNull(),
				]),
		)
		if (Option.isNone(member)) return Option.none<InvokePrincipal>()
		const user = yield* db.first(
			SQLite.from(schema.usersTable)
				.select()
				.where(($) => [$.id.eq(ownerId), $.deletedAt.isNull()]),
		)
		return Option.map(user, (row): InvokePrincipal => ({
			user: new CurrentUser.Schema({
				id: row.id,
				role: "member",
				avatarUrl: row.avatarUrl ?? undefined,
				firstName: row.firstName,
				lastName: row.lastName,
				email: row.email,
				isOnboarded: row.isOnboarded,
				timezone: row.timezone,
				settings: row.settings,
			}),
			botScopes: null,
			agent: null,
		}))
	})

/** Leave the thread in `status`, its follower done. */
const settleHosted = (
	threadId: AssistantThreadId,
	status: Assistant.ThreadStatus,
	errorMessage: string | null,
) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const now = new Date(yield* Clock.currentTimeMillis)
		yield* db.run(
			SQLite.update(schema.assistantThreadsTable)
				.set({ status, errorMessage, updatedAt: now, lastActivityAt: now })
				.where(($) => [$.id.eq(threadId)]),
		)
		yield* db.run(
			SQLite.update(schema.assistantFollowersTable)
				.set({ nextStepAt: null, turnStartedAt: null, failures: 0, updatedAt: now })
				.where(($) => [$.threadId.eq(threadId)]),
		)
	})

/**
 * Mark a turn no fiber runs any more (the instance was evicted mid-turn) as cut off: its open items
 * failed, the thread in error.
 */
export const cutOffTurn = Effect.fn("Assistant.cutOffTurn")(function* (threadId: AssistantThreadId) {
	const db = yield* Database.Database
	const now = new Date(yield* Clock.currentTimeMillis)
	yield* db.run(
		SQLite.update(schema.assistantItemsTable)
			.set({ status: "failed", updatedAt: now })
			.where(($) => [$.threadId.eq(threadId), $.status.eq("running")]),
	)
	yield* settleHosted(
		threadId,
		"error",
		"The reply was cut off before it finished. Send your message again.",
	)
})

type TurnOutcome =
	| { readonly _tag: "Done" }
	| { readonly _tag: "Stopped" }
	| { readonly _tag: "Failed"; readonly message: string }

/**
 * One turn of a hosted thread, run by the alarm: the model with the owner's key, the read toolkit
 * acting as the owner, the reply streamed into items. Never fails: every ending is written.
 */
export const runHostedTurn = Effect.fn("Assistant.hostedTurn")(
	function* (thread: schema.AssistantThread, toolTitle: (name: string) => string) {
		const db = yield* Database.Database
		const host = yield* AssistantHost
		const models = yield* HostedModels
		const provider = thread.engine as Assistant.HostedProvider
		const model = HOSTED_MODELS[provider]
		yield* Effect.annotateCurrentSpan({
			"assistant.thread_id": thread.id,
			"gen_ai.system": provider,
			"gen_ai.request.model": model,
		})

		const key = yield* hostedKey(thread.ownerId, provider)
		if (Option.isNone(key)) {
			return yield* settleHosted(
				thread.id,
				"error",
				`Add your ${providerName(provider)} API key in the AI panel to continue this chat.`,
			)
		}
		const principal = yield* ownerPrincipal(thread.organizationId, thread.ownerId)
		if (Option.isNone(principal) || principal.value.user === null) {
			return yield* settleHosted(
				thread.id,
				"error",
				"Only a member of this organization can continue this chat.",
			)
		}
		const user = principal.value.user

		const startedAt = new Date(yield* Clock.currentTimeMillis)
		const before = yield* db.first(
			SQLite.from(schema.assistantFollowersTable)
				.select()
				.where(($) => [$.threadId.eq(thread.id)]),
		)
		if (Option.isNone(before)) return
		// Marked as running here: not due again unless the turn is cut off.
		yield* db.run(
			SQLite.update(schema.assistantFollowersTable)
				.set({ turnStartedAt: startedAt, nextStepAt: new Date(startedAt.getTime() + TURN_LEASE_MS) })
				.where(($) => [$.threadId.eq(thread.id)]),
		)
		const items = yield* db.run(
			SQLite.from(schema.assistantItemsTable)
				.select()
				.where(($) => [$.threadId.eq(thread.id), $.deletedAt.isNull()])
				.orderBy(($) => [
					[$.createdAt, "asc"],
					[$.id, "asc"],
				]),
		)

		const stop = yield* Deferred.make<void>()
		const writer = yield* makeWriter({
			threadId: thread.id,
			runId: `hosted:${startedAt.getTime()}`,
			toolTitle,
		})

		const access = yield* host.self === null
			? memberAccessViaStubs(principal.value)
			: memberAccessInObject(host.self, principal.value)
		const toolkit = yield* toAiToolkit(hazelReadTools, { user }, (tool, run) =>
			run.pipe(
				Effect.withSpan("Assistant.toolCall", {
					attributes: { "gen_ai.tool.name": tool.name, "assistant.thread_id": thread.id },
				}),
			),
		).pipe(Effect.provideService(MemberAccess, access))

		const body: Effect.Effect<TurnOutcome> = runLoop({
			prompt: promptOf(thread, items),
			toolkit,
			provider,
			model,
			onPart: writer.onPart,
		}).pipe(
			Effect.provide(models.languageModel(provider, key.value, model)),
			Effect.tap((usage) =>
				Effect.annotateCurrentSpan({
					"gen_ai.usage.input_tokens": usage.inputTokens,
					"gen_ai.usage.output_tokens": usage.outputTokens,
				}),
			),
			Effect.as<TurnOutcome>({ _tag: "Done" }),
			Effect.timeoutOrElse({
				duration: TURN_TIMEOUT,
				orElse: () =>
					Effect.succeed<TurnOutcome>({
						_tag: "Failed",
						message: "The reply took too long and was stopped.",
					}),
			}),
			Effect.catchTags({
				AiError: (error) =>
					Effect.succeed<TurnOutcome>({ _tag: "Failed", message: failureMessage(provider, error) }),
				StreamIdleError: (error) =>
					Effect.succeed<TurnOutcome>({ _tag: "Failed", message: failureMessage(provider, error) }),
				IterationTimeoutError: (error) =>
					Effect.succeed<TurnOutcome>({ _tag: "Failed", message: failureMessage(provider, error) }),
				DegenerateOutputError: (error) =>
					Effect.succeed<TurnOutcome>({ _tag: "Failed", message: failureMessage(provider, error) }),
			}),
		)

		host.turns.set(thread.id, { stop: Deferred.succeed(stop, undefined).pipe(Effect.asVoid) })
		const outcome = yield* Effect.raceFirst(
			body,
			Effect.as(Deferred.await(stop), { _tag: "Stopped" } as TurnOutcome),
		).pipe(Effect.ensuring(Effect.sync(() => host.turns.delete(thread.id))))
		yield* Effect.annotateCurrentSpan({ "assistant.outcome": outcome._tag })

		yield* writer.finish(
			outcome._tag === "Failed" ? "failed" : "completed",
			outcome._tag === "Stopped" ? "Stopped" : "Did not finish",
		)
		if (outcome._tag === "Stopped") return yield* settleHosted(thread.id, "idle", null)

		// A message sent during the turn re-armed the follower: the next turn answers it.
		const after = yield* db.first(
			SQLite.from(schema.assistantFollowersTable)
				.select()
				.where(($) => [$.threadId.eq(thread.id)]),
		)
		const rearmed =
			Option.isSome(after) && after.value.updatedAt.getTime() !== before.value.updatedAt.getTime()
		if (rearmed && outcome._tag === "Done") {
			const now = new Date(yield* Clock.currentTimeMillis)
			yield* db.run(
				SQLite.update(schema.assistantFollowersTable)
					.set({ turnStartedAt: null, nextStepAt: now })
					.where(($) => [$.threadId.eq(thread.id)]),
			)
			return
		}
		yield* settleHosted(
			thread.id,
			outcome._tag === "Failed" ? "error" : "idle",
			outcome._tag === "Failed" ? outcome.message : null,
		)
	},
	(effect, thread) =>
		effect.pipe(
			// A defect still ends the turn in a state the member can read.
			// An interruption is the instance going away: nothing is written (the next one cuts it off).
			Effect.catchCause((cause) =>
				Cause.hasInterruptsOnly(cause)
					? Effect.failCause(cause)
					: Effect.logError("Hosted turn failed", { threadId: thread.id, cause }).pipe(
							Effect.andThen(
								settleHosted(thread.id, "error", "The reply failed. Try again in a moment."),
							),
							Effect.orDie,
						),
			),
		),
)
