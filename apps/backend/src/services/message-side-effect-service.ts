import { Database, SQLite, schema } from "@hazel/db"
import { WorkflowInitializationError, WorkflowServiceUnavailableError } from "@hazel/domain"
import { Array, Cause, Config, Context, Effect, Exit, Layer, Option } from "effect"
import type {
	MessageCreatedPayload,
	MessageDeletedPayload,
	MessageUpdatedPayload,
	ReactionCreatedPayload,
	ReactionDeletedPayload,
} from "@hazel/backend-core"
import { DiscordSyncWorker, DiscordSyncWorkerLayer } from "./chat-sync/discord-sync-worker"
import { makeClusterClient } from "../lib/cluster-client"

/**
 * The outbox handlers for message and reaction events. A handler that fails makes the outbox
 * retry the event with backoff, so every failure that may succeed later (database blips, the
 * cluster or Discord being unreachable) propagates. Retries are safe: Discord deliveries are
 * deduped by their receipts and the workflows by their idempotency keys.
 */
export class MessageSideEffectService extends Context.Service<MessageSideEffectService>()(
	"MessageSideEffectService",
	{
		make: Effect.gen(function* () {
			const db = yield* Database.Database
			const discordSyncWorker = yield* DiscordSyncWorker
			const clusterUrl = yield* Config.String("CLUSTER_URL")
			const client = yield* makeClusterClient(clusterUrl)

			/** Fails rather than guessing: a guess of "none" would echo bot messages back to Discord. */
			const resolveIntegrationBotUserId = Effect.fn(
				"MessageSideEffectService.resolveIntegrationBotUserId",
			)(function* () {
				const integrationBot = yield* db.first(
					SQLite.from(schema.usersTable)
						.select("id")
						.where(($) => [$.externalId.eq("integration-bot-discord"), $.deletedAt.isNull()])
						.limit(1),
				)

				return Option.getOrNull(Option.map(integrationBot, (row) => row.id))
			})

			const handleMessageCreated = Effect.fn("MessageSideEffectService.handleMessageCreated")(
				function* (payload: MessageCreatedPayload, dedupeKey: string) {
					const integrationBotUserId = yield* resolveIntegrationBotUserId()
					// Settled now, failed last: a Discord outage must not hold back notifications.
					const discordSync =
						payload.authorId === integrationBotUserId
							? Exit.void
							: yield* discordSyncWorker
									.syncHazelMessageCreateToAllConnections(payload.messageId, dedupeKey)
									.pipe(Effect.asVoid, Effect.exit)

					const channelResult = yield* db.run(
						SQLite.from(schema.channelsTable)
							.select("type", "name")
							.where(($) => [$.id.eq(payload.channelId)])
							.limit(1),
					)

					const channelType = Array.head(channelResult).pipe(
						Option.map((row) => row.type),
						Option.getOrElse(() => "public" as const),
					)

					yield* client.workflows
						.MessageNotificationWorkflow({
							payload: {
								messageId: payload.messageId,
								channelId: payload.channelId,
								authorId: payload.authorId,
								channelType,
								content: payload.content,
								replyToMessageId: payload.replyToMessageId,
							},
						})
						.pipe(
							Effect.catchTags({
								HttpClientError: (cause) =>
									Effect.fail(
										new WorkflowServiceUnavailableError({
											message: "Cluster unreachable for the notification workflow",
											cause,
										}),
									),
								// The workflow ran and failed; its result is stored under the message id,
								// so a retry would get the same failure back.
								GetChannelMembersError: (cause) =>
									Effect.logError("MessageNotificationWorkflow failed", Cause.fail(cause)),
								CreateNotificationError: (cause) =>
									Effect.logError("MessageNotificationWorkflow failed", Cause.fail(cause)),
								SchemaError: (cause) =>
									Effect.fail(
										new WorkflowInitializationError({
											message: "Failed to execute notification workflow",
											cause,
										}),
									),
							}),
						)

					if (channelType === "thread") {
						yield* nameThreadIfDue(payload, Array.head(channelResult))
					}

					yield* discordSync
				},
			)

			const nameThreadIfDue = Effect.fn("MessageSideEffectService.nameThreadIfDue")(function* (
				payload: MessageCreatedPayload,
				channel: Option.Option<{ name: string }>,
			) {
				const messageCountResult = yield* db.run(
					SQLite.from(schema.messagesTable)
						.select(() => ({ count: SQLite.count() }))
						.where(($) => [$.channelId.eq(payload.channelId), $.deletedAt.isNull()]),
				)

				const count = Array.head(messageCountResult).pipe(
					Option.map((r) => r.count),
					Option.getOrElse(() => 0),
				)
				const channelName = Option.getOrNull(Option.map(channel, (row) => row.name))
				if (count <= 3 || channelName !== "Thread") {
					return
				}

				const originalMessage = yield* db.first(
					SQLite.from(schema.messagesTable)
						.select("id")
						.where(($) => [$.threadChannelId.eq(payload.channelId)])
						.limit(1),
				)
				if (Option.isNone(originalMessage)) {
					return
				}

				// Naming is best-effort: a failed run is stored under the thread's idempotency key, so
				// only an unreachable cluster is worth a retry.
				const logNamingFailure = (cause: unknown) =>
					Effect.logWarning("ThreadNamingWorkflow failed", {
						threadChannelId: payload.channelId,
						cause: Cause.pretty(Cause.fail(cause)),
					})

				yield* client.workflows
					.ThreadNamingWorkflow({
						payload: {
							threadChannelId: payload.channelId,
							originalMessageId: originalMessage.value.id,
						},
					})
					.pipe(
						Effect.catchTags({
							HttpClientError: (cause) =>
								Effect.fail(
									new WorkflowServiceUnavailableError({
										message: "Cluster unreachable for the thread naming workflow",
										cause,
									}),
								),
							ThreadChannelNotFoundError: logNamingFailure,
							OriginalMessageNotFoundError: logNamingFailure,
							ThreadContextQueryError: logNamingFailure,
							AIProviderUnavailableError: logNamingFailure,
							AIRateLimitError: logNamingFailure,
							AIResponseParseError: logNamingFailure,
							ThreadNameUpdateError: logNamingFailure,
							SchemaError: logNamingFailure,
						}),
					)
			})

			const handleMessageUpdated = Effect.fn("MessageSideEffectService.handleMessageUpdated")(
				function* (payload: MessageUpdatedPayload, dedupeKey: string) {
					yield* discordSyncWorker.syncHazelMessageUpdateToAllConnections(
						payload.messageId,
						dedupeKey,
					)
				},
			)

			const handleMessageDeleted = Effect.fn("MessageSideEffectService.handleMessageDeleted")(
				function* (payload: MessageDeletedPayload, dedupeKey: string) {
					yield* discordSyncWorker.syncHazelMessageDeleteToAllConnections(
						payload.messageId,
						dedupeKey,
					)
				},
			)

			const handleReactionCreated = Effect.fn("MessageSideEffectService.handleReactionCreated")(
				function* (payload: ReactionCreatedPayload, dedupeKey: string) {
					yield* discordSyncWorker.syncHazelReactionCreateToAllConnections(
						payload.reactionId,
						dedupeKey,
					)
				},
			)

			const handleReactionDeleted = Effect.fn("MessageSideEffectService.handleReactionDeleted")(
				function* (payload: ReactionDeletedPayload, dedupeKey: string) {
					yield* discordSyncWorker.syncHazelReactionDeleteToAllConnections(
						{
							hazelChannelId: payload.hazelChannelId,
							hazelMessageId: payload.hazelMessageId,
							emoji: payload.emoji,
							userId: payload.userId,
						},
						dedupeKey,
					)
				},
			)

			return {
				handleMessageCreated,
				handleMessageUpdated,
				handleMessageDeleted,
				handleReactionCreated,
				handleReactionDeleted,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(DiscordSyncWorkerLayer))
}
