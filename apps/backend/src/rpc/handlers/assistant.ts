import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser, UnauthorizedError, withRemapDbErrors } from "@hazel/domain"
import { AssistantQuestionClosedError, AssistantRpcs, AssistantThreadNotFoundError } from "@hazel/domain/rpc"
import type { AssistantThreadId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option } from "effect"
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
import { t3CodeLink } from "../../worker/objects/org/t3code"

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
					const link = yield* t3CodeLink({ userId: user.id })
					return {
						t3code:
							link === null
								? { state: "not_connected" as const, environmentLabel: null }
								: {
										state:
											link.status === "active"
												? ("connected" as const)
												: ("expired" as const),
										environmentLabel: link.metadata.environmentLabel,
									},
					}
				}).pipe(withRemapDbErrors("AssistantThread", "select")),

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
					yield* startThread({ organizationId, ownerId: user.id, threadId, message, context })
					return yield* written(threadId)
				}).pipe(withRemapDbErrors("AssistantThread", "create")),

			"assistant.send": ({ organizationId, threadId, message, context }) =>
				Effect.gen(function* () {
					const thread = yield* ownThread(organizationId, threadId)
					yield* sendMessage({ organizationId, thread, message, context })
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
