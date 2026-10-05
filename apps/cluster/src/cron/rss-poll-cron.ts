import * as ClusterCron from "effect/cluster/ClusterCron"
import { WorkflowEngine } from "effect/workflow"
import { and, Database, eq, isNull, lt, schema, sql } from "@hazel/db"
import { Cluster } from "@hazel/domain"
import * as Cron from "effect/Cron"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"

// Run every 5 minutes
const everyFiveMinutes = Cron.parseUnsafe("*/5 * * * *")

/**
 * Cron job that polls RSS feeds due for a refresh.
 * Runs every 5 minutes and triggers RssFeedPollWorkflow for each due feed.
 */
export const RssPollCronLayer = ClusterCron.make({
	name: "RssPoll",
	cron: everyFiveMinutes,
	execute: Effect.gen(function* () {
		const db = yield* Database.Database
		const engine = yield* WorkflowEngine.WorkflowEngine

		const now = yield* DateTime.now
		const nowIso = DateTime.formatIso(now)

		// Find all active subscriptions that are due for polling:
		// - enabled and not deleted
		// - last fetched + polling interval <= now (or never fetched)
		// - consecutive errors < 10 (circuit breaker)
		const dueSubscriptions = yield* db.execute((client) =>
			client
				.select({
					id: schema.rssSubscriptionsTable.id,
					channelId: schema.rssSubscriptionsTable.channelId,
					organizationId: schema.rssSubscriptionsTable.organizationId,
					feedUrl: schema.rssSubscriptionsTable.feedUrl,
					pollingIntervalMinutes: schema.rssSubscriptionsTable.pollingIntervalMinutes,
					createdAt: schema.rssSubscriptionsTable.createdAt,
				})
				.from(schema.rssSubscriptionsTable)
				.where(
					and(
						eq(schema.rssSubscriptionsTable.isEnabled, true),
						isNull(schema.rssSubscriptionsTable.deletedAt),
						lt(schema.rssSubscriptionsTable.consecutiveErrors, 10),
						sql`(
							${schema.rssSubscriptionsTable.lastFetchedAt} IS NULL
							OR ${schema.rssSubscriptionsTable.lastFetchedAt} + (${schema.rssSubscriptionsTable.pollingIntervalMinutes} || ' minutes')::interval <= ${nowIso}
						)`,
					),
				),
		)

		yield* Effect.annotateCurrentSpan("cron.due_count", dueSubscriptions.length)

		if (dueSubscriptions.length === 0) {
			return
		}

		yield* Effect.logInfo(`RSS Poll: Found ${dueSubscriptions.length} feeds due for polling`)

		// Use poll timestamp (rounded to 5min) for idempotent workflow execution IDs
		const pollTimestamp = Math.floor(DateTime.toEpochMillis(now) / (5 * 60 * 1000)) * (5 * 60 * 1000)

		// Trigger workflows for each due feed (concurrency: 5)
		yield* Effect.forEach(
			dueSubscriptions,
			(sub) =>
				engine
					.execute(Cluster.RssFeedPollWorkflow, {
						executionId: `rss-poll-${sub.id}-${pollTimestamp}`,
						payload: {
							subscriptionId: sub.id,
							channelId: sub.channelId,
							organizationId: sub.organizationId,
							feedUrl: sub.feedUrl,
							pollTimestamp,
							subscribedAt: sub.createdAt.getTime(),
						},
						discard: true,
					})
					.pipe(
						Effect.catch((err) =>
							Effect.gen(function* () {
								yield* Effect.logWarning(
									`Failed to execute RssFeedPollWorkflow for subscription ${sub.id}`,
									{ error: String(err) },
								)

								// Increment error counter
								yield* db
									.execute((client) =>
										client
											.update(schema.rssSubscriptionsTable)
											.set({
												consecutiveErrors: sql`${schema.rssSubscriptionsTable.consecutiveErrors} + 1`,
												lastErrorMessage:
													err instanceof Error ? err.message : String(err),
												lastErrorAt: new Date(),
												lastFetchedAt: new Date(),
												updatedAt: new Date(),
											})
											.where(eq(schema.rssSubscriptionsTable.id, sub.id)),
									)
									.pipe(
										Effect.catch((dbErr) =>
											Effect.logWarning("Failed to increment RSS error counter", {
												subscriptionId: sub.id,
												error: String(dbErr),
											}),
										),
									)
							}),
						),
					),
			{ concurrency: 5 },
		)

		yield* Effect.annotateCurrentSpan("cron.triggered_count", dueSubscriptions.length)
		yield* Effect.logInfo(`RSS Poll: Triggered workflows for ${dueSubscriptions.length} feeds`)
	}).pipe(Effect.withSpan("cron.RssPoll")),
	skipIfOlderThan: Duration.minutes(10),
})
