import type { UpsertAccount } from "@hazel/domain/customers"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { unmuteExpired } from "./compute"
import { type CustomersWorld, makeCustomersWorld, NOW, ok } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const clerkOrg = (id: string, name: string): UpsertAccount => ({
	_tag: "account",
	externalId: id,
	name,
	domains: [`${id}.com`],
	sameAs: [],
	onNoMatch: "create",
})

interface MuteRow {
	readonly id: string
	readonly name: string
	readonly attentionMutedAt: string | null
	readonly attentionMutedUntil: string | null
	readonly attentionMutedByUserId: string | null
}

const muteOf = (world: CustomersWorld, name: string) =>
	world.rows<MuteRow>(
		`SELECT id, name, attentionMutedAt, attentionMutedUntil, attentionMutedByUserId FROM customer_accounts WHERE name = ?`,
		name,
	)[0]!

const DAY_MS = 86_400_000

/** SQLite keeps an instant as `YYYY-MM-DD HH:MM:SS.SSS` (UTC). */
const msOfStored = (value: string | null) =>
	value === null ? null : Date.parse(`${value.replace(" ", "T")}Z`)

describe("Needs attention mute", () => {
	it("mutes for a while or until unmuted; the alarm ends a timed mute, unmuting ends either", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [
					clerkOrg("org_dev", "Acme Dev"),
					clerkOrg("org_int", "Internal"),
				])
				const dev = muteOf(world, "Acme Dev")
				const internal = muteOf(world, "Internal")
				const until = new Date(NOW.getTime() + 7 * DAY_MS)

				// Queue work: a member may mute.
				ok(
					yield* world.call(
						"customers.account.update",
						{ accountId: dev.id, attentionMute: { until } },
						world.member,
					),
				)
				ok(
					yield* world.call(
						"customers.account.update",
						{ accountId: internal.id, attentionMute: { until: null } },
						world.member,
					),
				)
				expect(muteOf(world, "Acme Dev").attentionMutedByUserId).toBe(world.member)
				expect(msOfStored(muteOf(world, "Acme Dev").attentionMutedUntil)).toBe(until.getTime())
				expect(muteOf(world, "Acme Dev").attentionMutedAt).not.toBeNull()
				expect(muteOf(world, "Internal")).toMatchObject({ attentionMutedUntil: null })
				expect(muteOf(world, "Internal").attentionMutedAt).not.toBeNull()

				// Before its end nothing changes; after it only the timed mute ends.
				expect(yield* world.object.run(unmuteExpired(new Date(until.getTime() - 1)))).toBe(0)
				expect(yield* world.object.run(unmuteExpired(new Date(until.getTime() + 1)))).toBe(1)
				expect(muteOf(world, "Acme Dev")).toMatchObject({
					attentionMutedAt: null,
					attentionMutedUntil: null,
					attentionMutedByUserId: null,
				})
				expect(muteOf(world, "Internal").attentionMutedAt).not.toBeNull()

				ok(
					yield* world.call(
						"customers.account.update",
						{ accountId: internal.id, attentionMute: null },
						world.member,
					),
				)
				expect(muteOf(world, "Internal")).toMatchObject({
					attentionMutedAt: null,
					attentionMutedByUserId: null,
				})
				const events = world.rows<{ type: string }>(
					`SELECT type FROM customer_events WHERE provider = 'hazel' AND type LIKE 'account.attention_%' ORDER BY rowid`,
				)
				expect(events.map((event) => event.type)).toEqual([
					"account.attention_muted",
					"account.attention_muted",
					"account.attention_unmuted",
					"account.attention_unmuted",
				])
			}),
		))
})
