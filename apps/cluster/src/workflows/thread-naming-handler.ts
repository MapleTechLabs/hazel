import { AiError, LanguageModel } from "effect/ai"
import { Activity } from "effect/workflow"
import { and, Database, eq, isNull, schema } from "@hazel/db"
import { Cluster } from "@hazel/domain"
import { Effect } from "effect"

const NAMING_PROMPT = `You are a helpful assistant that generates concise, descriptive thread names.
Based on the conversation below, generate a short thread name (3-6 words max) that captures the main topic.
The name should be descriptive but brief, like a subject line.

Do not use quotes, colons, or special formatting. Just return the plain thread name.

Original message that started the thread:
Author: {originalAuthor}
Content: {originalContent}

Thread replies:
{threadMessages}

Generate a concise thread name:`

export const ThreadNamingWorkflowLayer = Cluster.ThreadNamingWorkflow.toLayer(
	Effect.fn("workflow.ThreadNaming")(function* (
		payload: Cluster.ThreadNamingWorkflowPayload,
		_executionId: string,
	) {
		yield* Effect.annotateCurrentSpan("workflow.thread_channel_id", payload.threadChannelId)
		yield* Effect.annotateCurrentSpan("workflow.original_message_id", payload.originalMessageId)

		yield* Effect.logDebug(`Starting ThreadNamingWorkflow for thread ${payload.threadChannelId}`)

		// Activity 1: Get thread context from database
		const contextResult: Cluster.GetThreadContextResult = yield* Effect.gen(function* () {
			return yield* Activity.make({
				name: "GetThreadContext",
				success: Cluster.GetThreadContextResult,
				error: Cluster.ThreadNamingWorkflowError,
				execute: Effect.gen(function* () {
					const db = yield* Database.Database

					const threadChannel = yield* db
						.execute((client) =>
							client
								.select({
									id: schema.channelsTable.id,
									name: schema.channelsTable.name,
									parentChannelId: schema.channelsTable.parentChannelId,
								})
								.from(schema.channelsTable)
								.where(eq(schema.channelsTable.id, payload.threadChannelId))
								.limit(1),
						)
						.pipe(
							Effect.catchTag("DatabaseError", (err) =>
								Effect.fail(
									new Cluster.ThreadContextQueryError({
										threadChannelId: payload.threadChannelId,
										operation: "thread",
										cause: err,
									}),
								),
							),
						)

					if (threadChannel.length === 0) {
						return yield* Effect.fail(
							new Cluster.ThreadChannelNotFoundError({
								threadChannelId: payload.threadChannelId,
							}),
						)
					}

					const thread = threadChannel[0]!

					// Get original message (the one with threadChannelId pointing to this thread)
					const originalMessage = yield* db
						.execute((client) =>
							client
								.select({
									id: schema.messagesTable.id,
									content: schema.messagesTable.content,
									authorId: schema.messagesTable.authorId,
									createdAt: schema.messagesTable.createdAt,
									firstName: schema.usersTable.firstName,
									lastName: schema.usersTable.lastName,
								})
								.from(schema.messagesTable)
								.innerJoin(
									schema.usersTable,
									eq(schema.messagesTable.authorId, schema.usersTable.id),
								)
								.where(eq(schema.messagesTable.id, payload.originalMessageId))
								.limit(1),
						)
						.pipe(
							Effect.catchTag("DatabaseError", (err) =>
								Effect.fail(
									new Cluster.ThreadContextQueryError({
										threadChannelId: payload.threadChannelId,
										operation: "originalMessage",
										cause: err,
									}),
								),
							),
						)

					if (originalMessage.length === 0) {
						return yield* Effect.fail(
							new Cluster.OriginalMessageNotFoundError({
								threadChannelId: payload.threadChannelId,
								messageId: payload.originalMessageId,
							}),
						)
					}

					const orig = originalMessage[0]!

					// Get thread messages (messages in the thread channel)
					const threadMessages = yield* db
						.execute((client) =>
							client
								.select({
									id: schema.messagesTable.id,
									content: schema.messagesTable.content,
									authorId: schema.messagesTable.authorId,
									createdAt: schema.messagesTable.createdAt,
									firstName: schema.usersTable.firstName,
									lastName: schema.usersTable.lastName,
								})
								.from(schema.messagesTable)
								.innerJoin(
									schema.usersTable,
									eq(schema.messagesTable.authorId, schema.usersTable.id),
								)
								.where(
									and(
										eq(schema.messagesTable.channelId, payload.threadChannelId),
										isNull(schema.messagesTable.deletedAt),
									),
								)
								.orderBy(schema.messagesTable.createdAt)
								.limit(10),
						)
						.pipe(
							Effect.catchTag("DatabaseError", (err) =>
								Effect.fail(
									new Cluster.ThreadContextQueryError({
										threadChannelId: payload.threadChannelId,
										operation: "threadMessages",
										cause: err,
									}),
								),
							),
						)

					yield* Effect.annotateCurrentSpan("activity.thread_message_count", threadMessages.length)

					return {
						threadChannelId: payload.threadChannelId,
						currentName: thread.name,
						originalMessage: {
							id: orig.id,
							content: orig.content ?? "",
							authorId: orig.authorId,
							authorName: `${orig.firstName} ${orig.lastName}`.trim(),
							createdAt: orig.createdAt.toISOString(),
						},
						threadMessages: threadMessages.map((m) => ({
							id: m.id,
							content: m.content ?? "",
							authorId: m.authorId,
							authorName: `${m.firstName} ${m.lastName}`.trim(),
							createdAt: m.createdAt.toISOString(),
						})),
					}
				}),
			})
		}).pipe(
			Effect.tapError((err: { readonly _tag: string; readonly cause?: unknown }) =>
				Effect.logError("GetThreadContext activity failed", {
					threadChannelId: payload.threadChannelId,
					errorTag: err._tag,
					cause: err.cause != null ? String(err.cause) : undefined,
				}),
			),
		)

		// Activity 2: Generate thread name using AI
		const nameResult: Cluster.GenerateThreadNameResult = yield* Effect.gen(function* () {
			return yield* Activity.make({
				name: "GenerateThreadName",
				success: Cluster.GenerateThreadNameResult,
				error: Cluster.ThreadNamingWorkflowError,
				execute: Effect.gen(function* () {
					// Build the prompt
					const threadMessagesText = contextResult.threadMessages
						.map((m: Cluster.ThreadMessageContext) => `${m.authorName}: ${m.content}`)
						.join("\n")

					const prompt = NAMING_PROMPT.replace(
						"{originalAuthor}",
						contextResult.originalMessage.authorName,
					)
						.replace("{originalContent}", contextResult.originalMessage.content)
						.replace("{threadMessages}", threadMessagesText || "(no replies yet)")

					type AiMappedError =
						| Cluster.AIProviderUnavailableError
						| Cluster.AIRateLimitError
						| Cluster.AIResponseParseError

					// Call the AI model
					const response = yield* LanguageModel.generateText({
						prompt,
					}).pipe(
						Effect.catchTag(
							"AiError",
							(err: AiError.AiError): Effect.Effect<never, AiMappedError> => {
								const reason = err.reason
								if (reason._tag === "RateLimitError") {
									return Effect.fail(
										new Cluster.AIRateLimitError({
											provider: "openrouter",
										}),
									)
								}
								if (
									reason._tag === "InvalidOutputError" ||
									reason._tag === "StructuredOutputError"
								) {
									return Effect.fail(
										new Cluster.AIResponseParseError({
											threadChannelId: payload.threadChannelId,
											rawResponse: reason.message,
										}),
									)
								}
								return Effect.fail(
									new Cluster.AIProviderUnavailableError({
										provider: "openrouter",
										cause: err,
									}),
								)
							},
						),
					)

					// Clean up the response
					let threadName = response.text.trim()
					// Remove quotes if present
					threadName = threadName.replace(/^["']|["']$/g, "")
					// Truncate if too long (max 50 chars)
					if (threadName.length > 50) {
						threadName = threadName.substring(0, 47) + "..."
					}
					// Fallback if empty
					if (!threadName) {
						threadName = "Discussion"
					}

					yield* Effect.annotateCurrentSpan("activity.ai_provider", "openrouter")
					yield* Effect.annotateCurrentSpan("activity.generated_name", threadName)

					yield* Effect.logDebug(`Generated thread name: ${threadName}`)

					return { threadName }
				}),
			})
		}).pipe(
			Effect.tapError(
				(err: { readonly _tag: string; readonly provider?: string; readonly cause?: unknown }) =>
					Effect.logError("GenerateThreadName activity failed", {
						threadChannelId: payload.threadChannelId,
						errorTag: err._tag,
						provider: err.provider,
						cause: err.cause != null ? String(err.cause) : undefined,
					}),
			),
		)

		// Activity 3: Update thread name in database
		yield* Effect.gen(function* () {
			return yield* Activity.make({
				name: "UpdateThreadName",
				success: Cluster.UpdateThreadNameResult,
				error: Cluster.ThreadNamingWorkflowError,
				execute: Effect.gen(function* () {
					const db = yield* Database.Database

					yield* db
						.execute((client) =>
							client
								.update(schema.channelsTable)
								.set({
									name: nameResult.threadName,
									updatedAt: new Date(),
								})
								.where(eq(schema.channelsTable.id, payload.threadChannelId)),
						)
						.pipe(
							Effect.catchTag("DatabaseError", (err) =>
								Effect.fail(
									new Cluster.ThreadNameUpdateError({
										threadChannelId: payload.threadChannelId,
										newName: nameResult.threadName,
										cause: err,
									}),
								),
							),
						)

					yield* Effect.annotateCurrentSpan(
						"activity.previous_name",
						contextResult.currentName ?? "",
					)
					yield* Effect.annotateCurrentSpan("activity.new_name", nameResult.threadName)

					yield* Effect.logDebug(
						`Updated thread ${payload.threadChannelId} name from "${contextResult.currentName}" to "${nameResult.threadName}"`,
					)

					return {
						success: true,
						previousName: contextResult.currentName,
						newName: nameResult.threadName,
					}
				}),
			})
		}).pipe(
			Effect.tapError(
				(err: { readonly _tag: string; readonly newName?: string; readonly cause?: unknown }) =>
					Effect.logError("UpdateThreadName activity failed", {
						threadChannelId: payload.threadChannelId,
						errorTag: err._tag,
						newName: err.newName,
						cause: err.cause != null ? String(err.cause) : undefined,
					}),
			),
		)

		yield* Effect.logDebug(`ThreadNamingWorkflow completed for thread ${payload.threadChannelId}`)
	}),
)
