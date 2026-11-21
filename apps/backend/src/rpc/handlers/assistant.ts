import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser, UnauthorizedError, withRemapDbErrors } from "@hazel/domain"
import {
	AssistantEngineError,
	AssistantQuestionClosedError,
	AssistantRpcs,
	AssistantThreadNotFoundError,
} from "@hazel/domain/rpc"
import type { AssistantThreadId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Redacted } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import {
	answerQuestion,
	deleteThread,
	findThread,
	sendMessage,
	startThread,
	stopThread,
	updateThread,
} from "../../worker/objects/org/assistant"
import { HostedModels, providerName } from "../../worker/objects/org/assistant-hosted"
import {
	assistantStatusOf,
	removeHostedKey,
	saveHostedKey,
	setPreferredEngine,
} from "../../worker/objects/org/assistant-keys"

/**
 * The AI panel's RPC handlers. Run in the `OrgObject` (`rpc/routing.ts`), which also follows the
 * running threads on its alarm (`worker/objects/org/assistant.ts`). Only a thread's owner writes
 * to it; the engine's own checks (`t3CodeAccess`) refuse anyone who is no longer a member.
 */
export const AssistantRpcLive = AssistantRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database

		const refuse = (detail: string) =>
			Effect.fail(new UnauthorizedError({ message: "Not allowed", detail }))

		const requireMember = (organizationId: OrganizationId, userId: UserId) =>
			Effect.gen(function* () {
				const member = yield* db.first(
					SQLite.from(schema.organizationMembersTable)
						.select("id")
						.where(($) => [
							$.organizationId.eq(organizationId),
							$.userId.eq(userId),
							$.deletedAt.isNull(),
						])
						.limit(1),
				)
				if (Option.isNone(member)) return yield* refuse("Not a member of this organization")
			})

		/** The caller's own thread in this org. */
		const ownThread = (organizationId: OrganizationId, threadId: AssistantThreadId) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser.Context
				yield* requireMember(organizationId, user.id)
				const thread = yield* findThread(threadId)
				if (Option.isNone(thread) || thread.value.organizationId !== organizationId) {
					return yield* new AssistantThreadNotFoundError({ threadId })
				}
				if (thread.value.ownerId !== user.id) return yield* refuse("Only its owner can change a chat")
				return thread.value
			})

		/** The write's position: the engine committed its rows, so the head is past them. */
		const written = (threadId: AssistantThreadId) =>
			Effect.map(db.transaction(generateTransactionId()), (transactionId) => ({
				threadId,
				transactionId,
			}))

		return {
			"assistant.status": ({ organizationId }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					yield* requireMember(organizationId, user.id)
					return yield* assistantStatusOf(user.id)
				}).pipe(withRemapDbErrors("AssistantThread", "select")),

			// The key is checked with the provider, then stored encrypted; it is never logged or returned.
			"assistant.saveKey": ({ organizationId, provider, apiKey }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					yield* requireMember(organizationId, user.id)
					const key = Redacted.make(apiKey.trim())
					const models = yield* HostedModels
					yield* models.checkKey(provider, key)
					yield* saveHostedKey({ userId: user.id, provider, apiKey: key })
					yield* setPreferredEngine({ userId: user.id, engine: provider })
					yield* Effect.annotateCurrentSpan({ "assistant.provider": provider })
					return yield* assistantStatusOf(user.id)
				}).pipe(withRemapDbErrors("AssistantThread", "update")),

			"assistant.removeKey": ({ organizationId, provider }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					yield* requireMember(organizationId, user.id)
					yield* removeHostedKey({ userId: user.id, provider })
					return yield* assistantStatusOf(user.id)
				}).pipe(withRemapDbErrors("AssistantThread", "update")),

			"assistant.setEngine": ({ organizationId, engine }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					yield* requireMember(organizationId, user.id)
					const status = yield* assistantStatusOf(user.id)
					if (status[engine].state !== "connected") {
						return yield* new AssistantEngineError({
							reason: "not_connected",
							message:
								engine === "t3code"
									? "Link T3 Code in Settings → Integrations first."
									: `Add your ${providerName(engine)} API key first.`,
						})
					}
					yield* setPreferredEngine({ userId: user.id, engine })
					return { ...status, preferredEngine: engine }
				}).pipe(withRemapDbErrors("AssistantThread", "update")),

			"assistant.start": ({ organizationId, threadId, message, context }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					yield* requireMember(organizationId, user.id)
					const existing = yield* findThread(threadId)
					// A retried start (the first answer was lost) is the same start.
					if (Option.isSome(existing)) {
						if (existing.value.ownerId !== user.id) return yield* refuse("Not your chat")
						return yield* written(threadId)
					}
					// New chats start on the member's preferred engine; follow-ups stay on their thread's.
					const { preferredEngine } = yield* assistantStatusOf(user.id)
					if (preferredEngine === null) {
						return yield* new AssistantEngineError({
							reason: "not_connected",
							message: "Link T3 Code or add an API key to use the AI panel.",
						})
					}
					yield* startThread({
						organizationId,
						ownerId: user.id,
						threadId,
						message,
						context,
						engine: preferredEngine,
					})
					return yield* written(threadId)
				}).pipe(withRemapDbErrors("AssistantThread", "create")),

			"assistant.send": ({ organizationId, threadId, messageId, message, context }) =>
				Effect.gen(function* () {
					const thread = yield* ownThread(organizationId, threadId)
					yield* sendMessage({ organizationId, thread, messageId, message, context })
					return yield* written(threadId)
				}).pipe(withRemapDbErrors("AssistantItem", "create")),

			"assistant.answer": ({ organizationId, threadId, itemId, answers }) =>
				Effect.gen(function* () {
					const thread = yield* ownThread(organizationId, threadId)
					const answered = yield* answerQuestion({ thread, itemId, answers })
					if (!answered) return yield* new AssistantQuestionClosedError({ itemId })
					return yield* written(threadId)
				}).pipe(withRemapDbErrors("AssistantItem", "update")),

			"assistant.stop": ({ organizationId, threadId }) =>
				Effect.gen(function* () {
					const thread = yield* ownThread(organizationId, threadId)
					yield* stopThread(thread)
					return yield* written(threadId)
				}).pipe(withRemapDbErrors("AssistantThread", "update")),

			"assistant.update": ({ organizationId, threadId, title, visibility }) =>
				Effect.gen(function* () {
					const thread = yield* ownThread(organizationId, threadId)
					yield* updateThread({ thread, title, visibility })
					yield* Effect.annotateCurrentSpan({
						"assistant.visibility": visibility ?? thread.visibility,
					})
					return yield* written(threadId)
				}).pipe(withRemapDbErrors("AssistantThread", "update")),

			"assistant.delete": ({ organizationId, threadId }) =>
				Effect.gen(function* () {
					const thread = yield* ownThread(organizationId, threadId)
					yield* deleteThread(thread)
					return yield* written(threadId)
				}).pipe(withRemapDbErrors("AssistantThread", "delete")),
		}
	}),
)
