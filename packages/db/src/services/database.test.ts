import type { D1ClientConfig } from "@effect/sql-d1/D1Client"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Channel } from "@hazel/domain/models"
import { Effect, ManagedRuntime, Option } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { layerMemory } from "../node"
import * as SQLite from "../sqlite"
import * as schema from "../tables"
import { Database, layerD1, sql } from "./database"
import { makeRepository } from "./repository"

let runtime: ManagedRuntime.ManagedRuntime<Database, never>

beforeAll(async () => {
	runtime = ManagedRuntime.make(layerMemory)
	await runtime.runPromise(
		Effect.gen(function* () {
			const db = yield* Database
			yield* db.execute(sql`CREATE TABLE _test_rollback (id TEXT PRIMARY KEY)`)
		}),
	)
})

afterAll(async () => {
	await runtime?.dispose()
})

const run = <A, E>(effect: Effect.Effect<A, E, Database>) => runtime.runPromise(effect)

const countRows = (id: string) =>
	Effect.gen(function* () {
		const db = yield* Database
		const rows = yield* db.query(sql`SELECT id FROM _test_rollback WHERE id = ${id}`)
		return rows.length
	})

const insertRow = (id: string) =>
	Effect.gen(function* () {
		const db = yield* Database
		yield* db.execute(sql`INSERT INTO _test_rollback (id) VALUES (${id})`)
	})

describe("Database.transaction", () => {
	it("rolls back when the body fails after a write", async () => {
		const id = `rollback-${Date.now()}`
		const result = await run(
			Effect.gen(function* () {
				const db = yield* Database
				const outcome = yield* db
					.transaction(
						Effect.gen(function* () {
							yield* insertRow(id)
							return yield* Effect.fail("intentional" as const)
						}),
					)
					.pipe(Effect.result)
				return { outcome: outcome._tag, count: yield* countRows(id) }
			}),
		)
		expect(result).toEqual({ outcome: "Failure", count: 0 })
	})

	it("commits when the body succeeds", async () => {
		const id = `commit-${Date.now()}`
		const count = await run(
			Effect.gen(function* () {
				const db = yield* Database
				yield* db.transaction(insertRow(id))
				return yield* countRows(id)
			}),
		)
		expect(count).toBe(1)
	})

	it("rolls back only the failed savepoint of a nested transaction", async () => {
		const outer = `outer-${Date.now()}`
		const inner = `inner-${Date.now()}`
		const counts = await run(
			Effect.gen(function* () {
				const db = yield* Database
				yield* db.transaction(
					Effect.gen(function* () {
						yield* insertRow(outer)
						yield* db
							.transaction(
								Effect.gen(function* () {
									yield* insertRow(inner)
									return yield* Effect.fail("inner" as const)
								}),
							)
							.pipe(Effect.ignore)
					}),
				)
				return [yield* countRows(outer), yield* countRows(inner)]
			}),
		)
		expect(counts).toEqual([1, 0])
	})
	it("keeps the outer transaction usable after a conflict inside a savepoint", async () => {
		const id = `savepoint-${Date.now()}`
		const result = await run(
			Effect.gen(function* () {
				const db = yield* Database
				yield* insertRow(id)
				return yield* db.transaction(
					Effect.gen(function* () {
						// The pattern the unique-conflict fallbacks use: the insert in a savepoint, the lookup after.
						const conflict = yield* db.transaction(insertRow(id)).pipe(Effect.flip)
						return { conflict: conflict.type, count: yield* countRows(id) }
					}),
				)
			}),
		)
		expect(result).toEqual({ conflict: "unique_violation", count: 1 })
	})
})

describe("DatabaseError", () => {
	it("classifies a unique violation and names the constraint", async () => {
		const id = `unique-${Date.now()}`
		const error = await run(
			Effect.gen(function* () {
				yield* insertRow(id)
				return yield* Effect.flip(insertRow(id))
			}),
		)
		expect(error._tag).toBe("DatabaseError")
		expect(error.type).toBe("unique_violation")
		expect(error.constraint).toBe("_test_rollback.id")
		expect(error.sqlState).toBe("SQLITE_CONSTRAINT_PRIMARYKEY")
	})

	it("names a unique index from the columns SQLite reports", async () => {
		const error = await run(
			Effect.gen(function* () {
				const db = yield* Database
				const insert = db.run(
					SQLite.insertInto(schema.organizationsTable).values({ name: "Acme", slug: "acme" }),
				)
				yield* insert
				return yield* Effect.flip(insert)
			}),
		)
		expect(error.type).toBe("unique_violation")
		expect(error.constraint).toBe("organizations_slug_unique")
		expect(error.detail).toBe("organizations.slug")
	})

	it("names a partial unique index", async () => {
		const organizationId = crypto.randomUUID() as OrganizationId
		const error = await run(
			Effect.gen(function* () {
				const db = yield* Database
				const insert = db.run(
					SQLite.insertInto(schema.customEmojisTable).values({
						organizationId,
						name: "party",
						imageUrl: "https://example.com/party.png",
						createdBy: crypto.randomUUID() as UserId,
					}),
				)
				yield* insert
				return yield* Effect.flip(insert)
			}),
		)
		expect(error.constraint).toBe("custom_emojis_org_name_unique_idx")
	})
})

describe("Database.layerD1", () => {
	it("refuses a transaction before running its body", async () => {
		let ran = false
		// The binding is never reached: the transaction is refused first.
		const error = await Effect.runPromise(
			Effect.gen(function* () {
				const database = yield* Database
				return yield* Effect.flip(database.transaction(Effect.sync(() => (ran = true))))
			}).pipe(Effect.provide(layerD1({} as D1ClientConfig["db"]))),
		)
		expect(error.type).toBe("query_error")
		expect(ran).toBe(false)
	})
})

describe("Repository", () => {
	it("inserts, reads, updates and deletes through the table definitions", async () => {
		const organizationId = crypto.randomUUID() as OrganizationId
		const result = await run(
			Effect.gen(function* () {
				const repo = yield* makeRepository(
					schema.channelsTable,
					{ insert: Channel.Insert, update: Channel.Update },
					{ idColumn: "id", name: "Channel" },
				)
				const [created] = yield* repo.insert({
					name: "general",
					icon: null,
					type: "public",
					organizationId,
					parentChannelId: null,
					sectionId: null,
					deletedAt: null,
				})
				const found = yield* repo.findById(created!.id)
				const updated = yield* repo.update({
					id: created!.id,
					name: "renamed",
					deletedAt: new Date("2026-01-01T00:00:00Z"),
				})
				yield* repo.deleteById(created!.id)
				const afterDelete = yield* repo.findById(created!.id)
				return { created: created!, found, updated, afterDelete }
			}),
		)
		expect(result.created.name).toBe("general")
		expect(result.created.createdAt).toBeInstanceOf(Date)
		expect(result.created.organizationId).toBe(organizationId)
		expect(Option.getOrThrow(result.found).id).toBe(result.created.id)
		expect(result.updated.name).toBe("renamed")
		expect(result.updated.deletedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z")
		expect(Option.isNone(result.afterDelete)).toBe(true)
	})

	it("reads typed rows with filters and ordering", async () => {
		const organizationId = crypto.randomUUID() as OrganizationId
		const rows = await run(
			Effect.gen(function* () {
				const db = yield* Database
				yield* db.run(
					SQLite.insertInto(schema.channelsTable).values([
						{ name: "b", type: "public", organizationId },
						{ name: "a", type: "private", organizationId },
					]),
				)
				return yield* db.run(
					SQLite.from(schema.channelsTable)
						.select("id", "name", "type")
						.where(($) => [$.organizationId.eq(organizationId), $.deletedAt.isNull()])
						.orderBy(["name", "asc"]),
				)
			}),
		)
		expect(rows.map((row) => [row.name, row.type])).toEqual([
			["a", "private"],
			["b", "public"],
		])
		const _typed: ChannelId = rows[0]!.id
	})
})
