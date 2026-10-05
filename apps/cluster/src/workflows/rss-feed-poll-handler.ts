import { Activity } from "effect/workflow"
import { and, Database, eq, isNull, schema } from "@hazel/db"
import { Cluster } from "@hazel/domain"
import type { MessageId } from "@hazel/schema"
import { Rss } from "@hazel/integrations"
import { Effect, Option, Schema } from "effect"
import { BotUserService } from "../services/bot-user-service.ts"

export const RssFeedPollWorkflowLayer = Cluster.RssFeedPollWorkflow.toLayer(
	Effect.fn("workflow.RssFeedPoll")(function* (
		payload: Cluster.RssFeedPollWorkflowPayload,
		_executionId: string,
	) {
		yield* Effect.annotateCurrentSpan("workflow.subscription_id", payload.subscriptionId)
		yield* Effect.annotateCurrentSpan("workflow.feed_url", payload.feedUrl)
		yield* Effect.annotateCurrentSpan("workflow.channel_id", payload.channelId)

		yield* Effect.logDebug(
			`Starting RssFeedPollWorkflow for subscription ${payload.subscriptionId} (${payload.feedUrl})`,
		)

		// Activity 1: Fetch and parse the RSS feed
		const feedResult = yield* Effect.gen(function* () {
			return yield* Activity.make({
				name: "FetchAndParseFeed",
				success: Cluster.FetchRssFeedResult,
				error: Cluster.FetchRssFeedError,
				execute: Effect.gen(function* () {
					yield* Effect.logDebug(`Fetching RSS feed: ${payload.feedUrl}`)

					const parsedFeed = yield* Effect.tryPromise({
						try: () => Rss.fetchAndParseFeed(payload.feedUrl),
						catch: (error) =>
							new Cluster.FetchRssFeedError({
								subscriptionId: payload.subscriptionId,
								feedUrl: payload.feedUrl,
								message: error instanceof Error ? error.message : "Failed to fetch RSS feed",
								cause: error,
							}),
					})

					yield* Effect.annotateCurrentSpan("activity.item_count", parsedFeed.items.length)
					yield* Effect.logDebug(`Fetched ${parsedFeed.items.length} items from ${payload.feedUrl}`)

					return {
						feedTitle: parsedFeed.metadata.title,
						feedIconUrl: parsedFeed.metadata.iconUrl,
						items: parsedFeed.items.map((item) => ({
							guid: item.guid,
							title: item.title,
							description: item.description,
							link: item.link,
							pubDate: item.pubDate,
							author: item.author,
						})),
					}
				}),
			})
		}).pipe(
			Effect.tapError((err: { readonly _tag: string }) =>
				Effect.logError("FetchAndParseFeed activity failed", {
					errorTag: err._tag,
					feedUrl: payload.feedUrl,
				}),
			),
		)

		if (feedResult.items.length === 0) {
			yield* Effect.logDebug("No items in feed, updating subscription state")

			// Update subscription state even with no items
			yield* Activity.make({
				name: "UpdateSubscriptionState",
				success: Schema.Struct({ updated: Schema.Boolean }),
				error: Cluster.UpdateSubscriptionStateError,
				execute: Effect.gen(function* () {
					const db = yield* Database.Database

					yield* db
						.execute((client) =>
							client
								.update(schema.rssSubscriptionsTable)
								.set({
									lastFetchedAt: new Date(),
									consecutiveErrors: 0,
									lastErrorMessage: null,
									lastErrorAt: null,
									...(feedResult.feedTitle && { feedTitle: feedResult.feedTitle }),
									...(feedResult.feedIconUrl && {
										feedIconUrl: feedResult.feedIconUrl,
									}),
									updatedAt: new Date(),
								})
								.where(eq(schema.rssSubscriptionsTable.id, payload.subscriptionId)),
						)
						.pipe(
							Effect.catchTag("DatabaseError", (err) =>
								Effect.fail(
									new Cluster.UpdateSubscriptionStateError({
										subscriptionId: payload.subscriptionId,
										message: "Failed to update subscription state",
										cause: err,
									}),
								),
							),
						)

					return { updated: true }
				}),
			})

			return
		}

		// Activity 2: Filter new items and post messages
		const postResult = yield* Effect.gen(function* () {
			return yield* Activity.make({
				name: "FilterAndPostItems",
				success: Cluster.PostRssItemsResult,
				error: Schema.Union([Cluster.PostRssItemsError, Cluster.BotUserQueryError]),
				execute: Effect.gen(function* () {
					const db = yield* Database.Database
					const botUserService = yield* BotUserService

					// Get the RSS bot user ID
					const botUserOption = yield* botUserService.getRssBotUserId()
					if (Option.isNone(botUserOption)) {
						yield* Effect.logWarning("RSS bot user not found, cannot create messages")
						return { messageIds: [], messagesCreated: 0, itemGuidsPosted: [] }
					}
					const botUserId = botUserOption.value

					// Get already posted items for deduplication
					const postedItems = yield* db
						.execute((client) =>
							client
								.select({ itemGuid: schema.rssPostedItemsTable.itemGuid })
								.from(schema.rssPostedItemsTable)
								.where(eq(schema.rssPostedItemsTable.subscriptionId, payload.subscriptionId)),
						)
						.pipe(
							Effect.catchTags({
								DatabaseError: (err) =>
									Effect.fail(
										new Cluster.PostRssItemsError({
											channelId: payload.channelId,
											message: "Failed to query posted items",
											cause: err,
										}),
									),
							}),
						)

					const postedGuids = new Set(postedItems.map((p) => p.itemGuid))

					// Filter to only new items (GUID dedup + date filter)
					const newItems = feedResult.items.filter((item) => {
						if (postedGuids.has(item.guid)) return false
						// Skip items published before the subscription was created
						if (item.pubDate && new Date(item.pubDate).getTime() < payload.subscribedAt)
							return false
						return true
					})

					if (newItems.length === 0) {
						yield* Effect.logDebug("No new items to post")

						// Still update last fetched time (non-critical, use orDie)
						yield* db
							.execute((client) =>
								client
									.update(schema.rssSubscriptionsTable)
									.set({
										lastFetchedAt: new Date(),
										consecutiveErrors: 0,
										lastErrorMessage: null,
										lastErrorAt: null,
										...(feedResult.feedTitle && { feedTitle: feedResult.feedTitle }),
										...(feedResult.feedIconUrl && {
											feedIconUrl: feedResult.feedIconUrl,
										}),
										updatedAt: new Date(),
									})
									.where(eq(schema.rssSubscriptionsTable.id, payload.subscriptionId)),
							)
							.pipe(Effect.orDie)

						return { messageIds: [], messagesCreated: 0, itemGuidsPosted: [] }
					}

					// Post up to 5 items per poll cycle (flood protection)
					const itemsToPost = newItems.slice(0, 5)
					const messageIds: MessageId[] = []
					const itemGuidsPosted: string[] = []

					yield* Effect.annotateCurrentSpan("activity.new_item_count", newItems.length)

					yield* Effect.logDebug(
						`Posting ${itemsToPost.length} new items (of ${newItems.length} total new)`,
					)

					for (const item of itemsToPost) {
						const embed = Rss.buildRssEmbed(item, feedResult.feedTitle)

						const messageResult = yield* db
							.execute((client) =>
								client
									.insert(schema.messagesTable)
									.values({
										channelId: payload.channelId,
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
											new Cluster.PostRssItemsError({
												channelId: payload.channelId,
												message: "Failed to create RSS message",
												cause: err,
											}),
										),
								}),
							)

						if (messageResult.length > 0) {
							const messageId = messageResult[0]!.id
							messageIds.push(messageId)
							itemGuidsPosted.push(item.guid)

							// Record posted item for deduplication (non-critical)
							yield* db
								.execute((client) =>
									client.insert(schema.rssPostedItemsTable).values({
										subscriptionId: payload.subscriptionId,
										itemGuid: item.guid,
										itemUrl: item.link || null,
										messageId,
									}),
								)
								.pipe(
									Effect.catch((err) =>
										Effect.logWarning(
											"Failed to record posted item (may cause duplicate on next poll)",
											{ error: err, itemGuid: item.guid },
										),
									),
								)

							yield* Effect.logDebug(`Posted RSS item "${item.title}" as message ${messageId}`)
						}
					}

					// Update subscription state (non-critical, use orDie)
					const lastItem = itemsToPost[0]
					yield* db
						.execute((client) =>
							client
								.update(schema.rssSubscriptionsTable)
								.set({
									lastFetchedAt: new Date(),
									lastItemGuid: lastItem?.guid ?? null,
									lastItemPublishedAt: lastItem?.pubDate
										? new Date(lastItem.pubDate)
										: null,
									consecutiveErrors: 0,
									lastErrorMessage: null,
									lastErrorAt: null,
									...(feedResult.feedTitle && { feedTitle: feedResult.feedTitle }),
									...(feedResult.feedIconUrl && {
										feedIconUrl: feedResult.feedIconUrl,
									}),
									updatedAt: new Date(),
								})
								.where(eq(schema.rssSubscriptionsTable.id, payload.subscriptionId)),
						)
						.pipe(Effect.orDie)

					yield* Effect.annotateCurrentSpan("activity.messages_created", messageIds.length)

					return {
						messageIds,
						messagesCreated: messageIds.length,
						itemGuidsPosted,
					}
				}),
			})
		}).pipe(
			Effect.tapError((err: { readonly _tag: string }) =>
				Effect.logError("FilterAndPostItems activity failed", {
					errorTag: err._tag,
				}),
			),
		)

		yield* Effect.logDebug(
			`RssFeedPollWorkflow completed: ${postResult.messagesCreated} messages created from ${payload.feedUrl}`,
		)
	}),
)
