#!/usr/bin/env bun

import { Database, SQLite, schema } from "@hazel/db"
import { Effect, Layer, References } from "effect"
import { ChannelAccessSyncService } from "../src/services/channel-access-sync"
import { DatabaseLive } from "../src/services/database"

const rebuildChannelAccess = Effect.gen(function* () {
	const db = yield* Database.Database

	yield* Effect.logInfo("Rebuilding channel_access table")

	yield* db.run(SQLite.deleteFrom(schema.channelAccessTable).allRows())

	const activeNonThreadChannels = yield* db.run(
		SQLite.from(schema.channelsTable)
			.select("id")
			.where(($) => [$.deletedAt.isNull(), $.type.neq("thread")]),
	)

	yield* Effect.forEach(
		activeNonThreadChannels,
		(channel) => ChannelAccessSyncService.use((service) => service.syncChannel(channel.id)),
		{ concurrency: 20 },
	)

	const threadChannels = yield* db.run(
		SQLite.from(schema.channelsTable)
			.select("id")
			.where(($) => [$.deletedAt.isNull(), $.type.eq("thread")]),
	)

	yield* Effect.forEach(
		threadChannels,
		(channel) => ChannelAccessSyncService.use((service) => service.syncChannel(channel.id)),
		{
			concurrency: 20,
		},
	)

	const countResult = yield* db.run(
		SQLite.from(schema.channelAccessTable).select(() => ({ count: SQLite.count() })),
	)
	const count = countResult[0]?.count ?? 0

	console.log(
		`channel_access rebuilt: ${activeNonThreadChannels.length} non-thread channels, ${threadChannels.length} threads, ${count} rows`,
	)
})

const ChannelAccessSyncLive = ChannelAccessSyncService.layer.pipe(Layer.provideMerge(DatabaseLive))

Effect.runPromise(
	rebuildChannelAccess.pipe(
		Effect.provide(ChannelAccessSyncLive),
		Effect.provide(DatabaseLive),
		Effect.provideService(References.MinimumLogLevel, "Info"),
	),
).catch((error) => {
	console.error("Failed to rebuild channel_access", error)
	process.exit(1)
})
