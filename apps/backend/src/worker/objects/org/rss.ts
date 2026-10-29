/**
 * RSS polling inside the `OrgObject` (replaces the cluster's `rss-poll` cron and
 * `RssFeedPollWorkflow`). The object's alarm is armed for the earliest due subscription
 * (`rssDeadlines`); when it fires, `pollDueRssFeeds` fetches each due feed (outside any
 * transaction), then in one transaction per feed records the new items in `rss_posted_items` and
 * posts each as a `channel.postSystemMessage` to the subscribed channel's `ChannelObject`, authored
 * by the shared RSS bot user. A failing feed counts `consecutiveErrors`; at `MAX_ERRORS` it stops
 * being polled until its subscription is updated.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { Rss } from "@hazel/integrations"
import { MessageId } from "@hazel/schema"
import { Clock, Effect, Option, Schema } from "effect"
import { ChannelEffects } from "../effects/channel-effects"
import { enqueueEffect } from "../effects/registry"
import { channelTarget } from "../kinds"

export const MAX_ERRORS = 10
/** Flood protection: new items posted per poll. */
export const MAX_ITEMS_PER_POLL = 5
const FETCH_TIMEOUT_MS = 10_000
/** The shared RSS bot (`WebhookBotService.getOrCreateIntegrationBot("rss", …)`). */
const RSS_BOT_EXTERNAL_ID = "integration-bot-rss"

export class RssFetchError extends Schema.TaggedError<RssFetchError>()("RssFetchError", {
	feedUrl: Schema.String,
	message: Schema.String,
}) {}

/** Fetch and parse a feed with `fetch` (the Worker has no node http). */
export const fetchFeed = (feedUrl: string) =>
	Effect.tryPromise({
		try: async (signal) => {
			const response = await fetch(feedUrl, {
				headers: Rss.FEED_REQUEST_HEADERS,
				redirect: "follow",
				signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
			})
			if (!response.ok) throw new Error(`Feed answered HTTP ${response.status}`)
			return await Rss.parseFeed(await response.text())
		},
		catch: (error) =>
			new RssFetchError({
				feedUrl,
				message: error instanceof Error ? error.message : "Failed to fetch RSS feed",
			}),
	}).pipe(Effect.withSpan("OrgObject.fetchRssFeed", { attributes: { "rss.feed_url": feedUrl } }))

const activeSubscriptions = Effect.flatMap(Database.Database, (db) =>
	db.run(
		SQLite.from(schema.rssSubscriptionsTable)
			.select()
			.where(($) => [$.isEnabled.eq(true), $.deletedAt.isNull(), $.consecutiveErrors.lt(MAX_ERRORS)]),
	),
)

const dueAt = (subscription: schema.RssSubscription) =>
	subscription.lastFetchedAt === null
		? 0
		: subscription.lastFetchedAt.getTime() + subscription.pollingIntervalMinutes * 60_000

/** When the next subscription is due, for the object's one alarm. */
export const rssDeadlines = activeSubscriptions.pipe(
	Effect.map((subscriptions) =>
		subscriptions.length === 0 ? [] : [Math.min(...subscriptions.map(dueAt))],
	),
	Effect.catchTag("DatabaseError", (error) =>
		Effect.logWarning("RSS deadline lookup failed", { error: error.message }).pipe(Effect.as([])),
	),
)

/** Record and post one fetched feed's new items; one transaction. */
const applyFeed = Effect.fn("OrgObject.applyRssFeed")(function* (
	subscription: schema.RssSubscription,
	feed: Rss.ParsedRssFeed,
	now: Date,
) {
	const db = yield* Database.Database
	const bot = yield* db.first(
		SQLite.from(schema.usersTable)
			.select("id")
			.where(($) => [$.externalId.eq(RSS_BOT_EXTERNAL_ID)])
			.limit(1),
	)
	const posted = yield* db.run(
		SQLite.from(schema.rssPostedItemsTable)
			.select("itemGuid")
			.where(($) => [$.subscriptionId.eq(subscription.id)]),
	)
	const seen = new Set(posted.map((row) => row.itemGuid))
	const subscribedAt = subscription.createdAt.getTime()
	const fresh = feed.items.filter(
		(item) =>
			!seen.has(item.guid) &&
			(item.pubDate === null || new Date(item.pubDate).getTime() >= subscribedAt),
	)
	const authorId = Option.getOrUndefined(Option.map(bot, (row) => row.id))
	const toPost = authorId === undefined ? [] : fresh.slice(0, MAX_ITEMS_PER_POLL)
	if (authorId === undefined && fresh.length > 0) {
		yield* Effect.logWarning("RSS bot user missing; items not posted", {
			subscriptionId: subscription.id,
		})
	}

	for (const item of toPost) {
		if (authorId === undefined) break
		const messageId = MessageId.make(crypto.randomUUID())
		yield* db.run(
			SQLite.insertInto(schema.rssPostedItemsTable).values({
				subscriptionId: subscription.id,
				itemGuid: item.guid,
				itemUrl: item.link || null,
				messageId,
			}),
		)
		yield* enqueueEffect(ChannelEffects.postSystemMessage, channelTarget(subscription.channelId), {
			id: messageId,
			channelId: subscription.channelId,
			authorId,
			content: "",
			embeds: [Rss.buildRssEmbed(item, feed.metadata.title)],
		})
	}

	const latest = toPost[0]
	yield* db.run(
		SQLite.update(schema.rssSubscriptionsTable)
			.set({
				lastFetchedAt: now,
				...(latest === undefined
					? {}
					: {
							lastItemGuid: latest.guid,
							lastItemPublishedAt: latest.pubDate === null ? null : new Date(latest.pubDate),
						}),
				consecutiveErrors: 0,
				lastErrorMessage: null,
				lastErrorAt: null,
				...(feed.metadata.title ? { feedTitle: feed.metadata.title } : {}),
				...(feed.metadata.iconUrl ? { feedIconUrl: feed.metadata.iconUrl } : {}),
				updatedAt: now,
			})
			.where(($) => [$.id.eq(subscription.id)]),
	)
	yield* Effect.annotateCurrentSpan({ "rss.new_items": fresh.length, "rss.posted": toPost.length })
})

const recordFailure = Effect.fn("OrgObject.recordRssFailure")(function* (
	subscription: schema.RssSubscription,
	error: RssFetchError,
	now: Date,
) {
	const db = yield* Database.Database
	yield* db.run(
		SQLite.update(schema.rssSubscriptionsTable)
			.set(($) => ({
				consecutiveErrors: $.consecutiveErrors.add(1),
				lastErrorMessage: error.message,
				lastErrorAt: now,
				lastFetchedAt: now,
				updatedAt: now,
			}))
			.where(($) => [$.id.eq(subscription.id)]),
	)
})

/** Poll every due subscription; returns how many were polled (the caller flushes if any). */
export const pollDueRssFeeds = Effect.gen(function* () {
	const db = yield* Database.Database
	const nowMs = yield* Clock.currentTimeMillis
	const due = (yield* activeSubscriptions).filter((subscription) => dueAt(subscription) <= nowMs)
	if (due.length === 0) return 0
	yield* Effect.forEach(
		due,
		(subscription) =>
			Effect.gen(function* () {
				const fetched = yield* Effect.result(fetchFeed(subscription.feedUrl))
				const now = new Date(yield* Clock.currentTimeMillis)
				yield* db.transaction(
					fetched._tag === "Success"
						? applyFeed(subscription, fetched.success, now)
						: recordFailure(subscription, fetched.failure, now),
				)
			}).pipe(
				Effect.catchTags({
					DatabaseError: (error) =>
						Effect.logWarning("RSS poll write failed", {
							subscriptionId: subscription.id,
							error: error.message,
						}),
					SchemaError: (error) =>
						Effect.logWarning("RSS poll post failed", {
							subscriptionId: subscription.id,
							error: error.message,
						}),
				}),
			),
		{ concurrency: 4, discard: true },
	)
	yield* Effect.annotateCurrentSpan({ "rss.polled": due.length })
	return due.length
}).pipe(
	Effect.catchTag("DatabaseError", (error) =>
		Effect.logWarning("RSS poll failed", { error: error.message }).pipe(Effect.as(0)),
	),
	Effect.withSpan("OrgObject.pollRss"),
)
