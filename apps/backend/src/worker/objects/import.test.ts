/**
 * The Postgres import's object side on node SQLite: `importRows` writes encoded rows straight into
 * the object's tables (skipping the ones the table rejects), and the org's `importFinalize`
 * re-derives the channel viewers, `channel_index`, `org_index`, `membership_index` and
 * `user_organizations`.
 */
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { encodeImportRow, importTableOf } from "../../lib/import-rows"
import { Directory } from "../../services/directory"
import { callObject } from "./calls"
import { ImportCalls } from "./import"
import { channelTarget, orgTarget, userTarget } from "./kinds"
import { ObjectStubs } from "./protocol"
import { makeTestObjects, type TestObject } from "./testing"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const rows = <T>(object: TestObject, query: string) => object.storage.db.prepare(query).all() as Array<T>

const encode = (table: string, row: Record<string, unknown>) =>
	encodeImportRow(Option.getOrThrow(importTableOf("org", table)), row).pipe(Effect.orDie)

describe("import into objects", () => {
	it("imports an org's rows, skips invalid ones, and finalizes its projections", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const orgId = crypto.randomUUID() as OrganizationId
				const owner = crypto.randomUUID() as UserId
				const channelId = crypto.randomUUID() as ChannelId
				const now = new Date("2026-01-02T03:04:05.000Z")
				const send = <A, E>(effect: Effect.Effect<A, E, ObjectStubs>) =>
					effect.pipe(Effect.provideService(ObjectStubs, objects.stubs))

				const batch = (table: string, list: ReadonlyArray<Record<string, unknown>>) =>
					Effect.gen(function* () {
						const encoded = yield* Effect.forEach(list, (row) => encode(table, row))
						return yield* send(
							callObject(ImportCalls.org.rows, orgTarget(orgId), { table, rows: encoded }),
						)
					})

				expect(
					yield* batch("organizations", [
						{ id: orgId, name: "Acme", slug: "acme", createdAt: now },
					]),
				).toEqual({ applied: 1, skipped: 0 })
				yield* batch("organization_members", [
					{ id: crypto.randomUUID(), organizationId: orgId, userId: owner, role: "owner" },
				])
				yield* batch("channels", [
					{ id: channelId, name: "general", type: "public", organizationId: orgId },
				])
				// A row its table rejects (an unknown enum value) is skipped, not fatal.
				const bad = yield* send(
					callObject(ImportCalls.org.rows, orgTarget(orgId), {
						table: "channels",
						rows: [{ id: crypto.randomUUID(), name: "x", type: "galaxy", organizationId: orgId }],
					}),
				)
				expect(bad).toEqual({ applied: 0, skipped: 1 })
				const unknown = yield* send(
					callObject(ImportCalls.org.rows, orgTarget(orgId), { table: "messages", rows: [] }),
				).pipe(Effect.flip)
				expect(unknown._tag).toBe("ImportTableError")

				yield* send(callObject(ImportCalls.org.finalize, orgTarget(orgId), {}))

				const channel = yield* objects.get(channelTarget(channelId))
				expect(rows(channel, `SELECT userId, role FROM channel_viewers`)).toEqual([
					{ userId: owner, role: "owner" },
				])
				const directory = Effect.provideContext(objects.directory)
				const index = yield* Effect.flatMap(Directory, (d) => d.orgBySlug("acme")).pipe(directory)
				expect(Option.map(index, (row) => row.id)).toEqual(Option.some(orgId))
				const indexed = yield* Effect.flatMap(Directory, (d) => d.channel(channelId)).pipe(directory)
				expect(Option.map(indexed, (row) => row.organizationId)).toEqual(Option.some(orgId))
				expect(yield* Effect.flatMap(Directory, (d) => d.memberCount(orgId)).pipe(directory)).toBe(1)
				const user = yield* objects.get(userTarget(owner))
				expect(rows(user, `SELECT organizationId FROM user_organizations`)).toEqual([
					{ organizationId: orgId },
				])
			}),
		))
})
