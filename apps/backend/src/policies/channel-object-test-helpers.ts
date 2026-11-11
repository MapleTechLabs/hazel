/**
 * Policies as they run in a `ChannelObject`: the real repositories and `ChannelViewers` over a
 * node SQLite with every table, seeded by SQL, and `CurrentObject` set to `CHANNEL_ID`.
 */
import { layerMemory } from "@hazel/db/node"
import type { ChannelId, UserId } from "@hazel/schema"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { CurrentObject } from "../lib/current-object.ts"
import { TEST_ORG_ID } from "./policy-test-helpers.ts"

export const CHANNEL_ID = "00000000-0000-4000-8000-000000000901" as ChannelId

export type ViewerRole = "owner" | "admin" | "member" | "guest"

/** `statements` run in order before the policy is built. */
export const channelObjectLayer = <A, E, R>(
	policy: Layer.Layer<A, E, R>,
	viewers: Record<UserId, ViewerRole>,
	statements: ReadonlyArray<(sql: SqlClient) => Effect.Effect<unknown, unknown>> = [],
) => {
	const seeded = Layer.effectDiscard(
		Effect.gen(function* () {
			const sql = yield* SqlClient
			for (const [userId, role] of Object.entries(viewers)) {
				yield* sql`INSERT INTO channel_viewers (userId, organizationId, role)
					VALUES (${userId}, ${TEST_ORG_ID}, ${role})`
			}
			for (const statement of statements) yield* statement(sql)
		}).pipe(Effect.orDie),
	).pipe(Layer.provideMerge(layerMemory))
	return Layer.mergeAll(policy, Layer.succeed(CurrentObject, { kind: "channel", id: CHANNEL_ID })).pipe(
		Layer.provide(seeded),
	)
}

export const insertMessage =
	(id: string, authorId: UserId, channelId: ChannelId = CHANNEL_ID) =>
	(sql: SqlClient) =>
		sql`INSERT INTO messages (id, channelId, authorId, content) VALUES (${id}, ${channelId}, ${authorId}, 'hi')`
