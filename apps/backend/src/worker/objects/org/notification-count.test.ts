import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { orgTarget } from "../kinds"
import { makeTestObjects } from "../testing"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

describe("org.notificationsRemoved", () => {
	it.each([
		[5, 3, 2],
		[2, 3, 0],
		[3, 3, 0],
	])("count %i, %i removed: %i", (count, removed, expected) =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const orgId = crypto.randomUUID() as OrganizationId
				const org = yield* objects.get(orgTarget(orgId))
				const channelId = crypto.randomUUID() as ChannelId
				const userId = crypto.randomUUID() as UserId
				org.storage.db
					.prepare(
						`INSERT INTO channel_members (channelId, userId, notificationCount) VALUES (?, ?, ?)`,
					)
					.run(channelId, userId, count)
				const applied = yield* org.applyEffect({
					objectId: orgId,
					kind: "org.notificationsRemoved",
					payload: { channelId, userId, count: removed },
					key: "removed",
					sender: { kind: "user", id: userId },
				})
				expect(applied._tag).toBe("Applied")
				const row = org.storage.db
					.prepare(`SELECT notificationCount FROM channel_members WHERE userId = ?`)
					.get(userId) as { notificationCount: number }
				expect(row.notificationCount).toBe(expected)
			}),
		),
	)
})
