import { Activity } from "effect/workflow"
import { and, Database, eq, isNull, schema } from "@hazel/db"
import { Cluster } from "@hazel/domain"
import type { MessageId } from "@hazel/schema"
import { GitHub } from "@hazel/integrations"
import { Effect, Option, Schema } from "effect"
import { BotUserService } from "../services/bot-user-service.ts"

export const GitHubWebhookWorkflowLayer = Cluster.GitHubWebhookWorkflow.toLayer(
	Effect.fn("workflow.GitHubWebhook")(function* (
		payload: Cluster.GitHubWebhookWorkflowPayload,
		_executionId: string,
	) {
		yield* Effect.annotateCurrentSpan("workflow.event_type", payload.eventType)
		yield* Effect.annotateCurrentSpan("workflow.repository", payload.repositoryFullName)
		yield* Effect.annotateCurrentSpan("workflow.repository_id", payload.repositoryId)

		yield* Effect.logDebug(
			`Starting GitHubWebhookWorkflow for ${payload.eventType} event on ${payload.repositoryFullName}`,
		)

		// Map GitHub event type to our internal event type
		const internalEventType = GitHub.mapEventType(payload.eventType)
		if (!internalEventType) {
			yield* Effect.logDebug(`Ignoring unsupported event type: ${payload.eventType}`)
			return
		}

		// Activity 1: Get all subscriptions for this repository
		const subscriptionsResult = yield* Effect.gen(function* () {
			return yield* Activity.make({
				name: "GetGitHubSubscriptions",
				success: Cluster.GetGitHubSubscriptionsResult,
				error: Cluster.GetGitHubSubscriptionsError,
				execute: Effect.gen(function* () {
					const db = yield* Database.Database

					yield* Effect.logDebug(`Querying subscriptions for repository ${payload.repositoryId}`)

					const subscriptions = yield* db
						.execute((client) =>
							client
								.select({
									id: schema.githubSubscriptionsTable.id,
									channelId: schema.githubSubscriptionsTable.channelId,
									enabledEvents: schema.githubSubscriptionsTable.enabledEvents,
									branchFilter: schema.githubSubscriptionsTable.branchFilter,
								})
								.from(schema.githubSubscriptionsTable)
								.where(
									and(
										eq(
											schema.githubSubscriptionsTable.repositoryId,
											payload.repositoryId,
										),
										eq(schema.githubSubscriptionsTable.isEnabled, true),
										isNull(schema.githubSubscriptionsTable.deletedAt),
									),
								),
						)
						.pipe(
							Effect.catchTags({
								DatabaseError: (err) =>
									Effect.fail(
										new Cluster.GetGitHubSubscriptionsError({
											repositoryId: payload.repositoryId,
											message: "Failed to query GitHub subscriptions",
											cause: err,
										}),
									),
							}),
						)

					yield* Effect.annotateCurrentSpan("activity.subscription_count", subscriptions.length)

					yield* Effect.logDebug(
						`Found ${subscriptions.length} subscriptions for repository ${payload.repositoryId}`,
					)

					return {
						subscriptions: subscriptions.map((s) => ({
							id: s.id,
							channelId: s.channelId,
							enabledEvents: s.enabledEvents as Cluster.GitHubEventType[],
							branchFilter: s.branchFilter,
						})),
						totalCount: subscriptions.length,
					}
				}),
			})
		}).pipe(
			Effect.tapError((err: { readonly _tag: string; readonly retryable?: boolean }) =>
				Effect.logError("GetGitHubSubscriptions activity failed", {
					errorTag: err._tag,
					retryable: err.retryable,
				}),
			),
		)

		// Extract ref from payload for branch filtering
		const eventPayload = payload.eventPayload as { ref?: string }
		const ref = eventPayload.ref

		// Filter subscriptions by event type and branch filter
		const eligibleSubscriptions = subscriptionsResult.subscriptions.filter(
			(sub: Cluster.GitHubSubscriptionForWorkflow) => {
				// Check if event type is enabled
				if (!sub.enabledEvents.includes(internalEventType)) {
					return false
				}

				// For push events, check branch filter
				if (payload.eventType === "push" && !GitHub.matchesBranchFilter(sub.branchFilter, ref)) {
					return false
				}

				return true
			},
		)

		if (eligibleSubscriptions.length === 0) {
			yield* Effect.logDebug("No eligible subscriptions after filtering, workflow complete")
			return
		}

		yield* Effect.annotateCurrentSpan("workflow.eligible_count", eligibleSubscriptions.length)
		yield* Effect.logDebug(`${eligibleSubscriptions.length} subscriptions are eligible for this event`)

		// Build the embed for this event
		const embed = GitHub.buildGitHubEmbed(payload.eventType, payload.eventPayload)
		if (!embed) {
			yield* Effect.logDebug(`Could not build embed for event type: ${payload.eventType}`)
			return
		}

		// Activity 2: Create messages in subscribed channels
		const messagesResult = yield* Effect.gen(function* () {
			return yield* Activity.make({
				name: "CreateGitHubMessages",
				success: Cluster.CreateGitHubMessagesResult,
				error: Schema.Union([Cluster.CreateGitHubMessageError, Cluster.BotUserQueryError]),
				execute: Effect.gen(function* () {
					const db = yield* Database.Database
					const botUserService = yield* BotUserService
					const messageIds: MessageId[] = []

					yield* Effect.logDebug(`Creating messages in ${eligibleSubscriptions.length} channels`)

					// Get the GitHub bot user ID from cache
					const botUserOption = yield* botUserService.getGitHubBotUserId()

					if (Option.isNone(botUserOption)) {
						yield* Effect.logWarning("GitHub bot user not found, cannot create messages")
						return { messageIds: [], messagesCreated: 0 }
					}

					const botUserId = botUserOption.value

					// Create a message in each eligible channel
					for (const subscription of eligibleSubscriptions) {
						const messageResult = yield* db
							.execute((client) =>
								client
									.insert(schema.messagesTable)
									.values({
										channelId: subscription.channelId,
										authorId: botUserId,
										content: "",
										embeds: [embed],
										replyToMessageId: null,
										threadChannelId: null,
										deletedAt: null,
									})
									.returning({ id: schema.messagesTable.id }),
							)
							.pipe(
								Effect.catchTags({
									DatabaseError: (err) =>
										Effect.fail(
											new Cluster.CreateGitHubMessageError({
												channelId: subscription.channelId,
												message: "Failed to create GitHub message",
												cause: err,
											}),
										),
								}),
							)

						if (messageResult.length > 0) {
							messageIds.push(messageResult[0]!.id)
							yield* Effect.logDebug(
								`Created message ${messageResult[0]!.id} in channel ${subscription.channelId}`,
							)
						}
					}

					yield* Effect.annotateCurrentSpan("activity.messages_created", messageIds.length)

					return {
						messageIds,
						messagesCreated: messageIds.length,
					}
				}),
			})
		}).pipe(
			Effect.tapError((err: { readonly _tag: string; readonly retryable?: boolean }) =>
				Effect.logError("CreateGitHubMessages activity failed", {
					errorTag: err._tag,
					retryable: err.retryable,
				}),
			),
		)

		yield* Effect.logDebug(
			`GitHubWebhookWorkflow completed: ${messagesResult.messagesCreated} messages created for ${payload.eventType} event`,
		)
	}),
)
