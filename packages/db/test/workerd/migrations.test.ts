import { env } from "cloudflare:test"
import { describe, expect, it } from "vitest"
import { storeMigrations } from "../../src/schema-ddl"
import { storeNames } from "../../src/stores"
import type { Env } from "./worker"

const testEnv = env as unknown as Env
const stub = (name: string) => testEnv.STORE.get(testEnv.STORE.idFromName(name))

describe("object store migrations on workerd DO SQLite", () => {
	it.each(storeNames.filter((store) => store !== "directory"))("migrates the %s store", async (store) => {
		const object = stub(`store-${store}`)
		expect(await object.migrate(store)).toEqual({
			applied: storeMigrations[store].map((migration) => migration.id),
			failed: [],
		})
		expect(await object.migrate(store)).toEqual({ applied: [], failed: [] })
	})

	it("runs the org's FTS5 message search: unicode61 with diacritics removed, kept by triggers", async () => {
		const object = stub("org-search")
		expect((await object.migrate("org")).failed).toEqual([])
		const insert = `INSERT INTO message_search ("messageId", "channelId", "authorId", "conversationId", "createdAt", "content")
			VALUES (?, 'c1', 'u1', NULL, ?, ?)`
		await object.query(insert, ["m1", 1, "Café meeting moved to Thursday"])
		await object.query(insert, ["m2", 2, "Résumé review at noon"])
		await object.query(insert, ["m3", 3, "Lunch plans"])
		const search = async (match: string) =>
			(
				await object.query(
					`SELECT s."messageId", snippet(message_search_fts, 0, char(2), char(3), '…', 24) AS snippet
					FROM message_search_fts JOIN message_search s ON s."id" = message_search_fts.rowid
					WHERE message_search_fts MATCH ? ORDER BY s."createdAt" DESC`,
					[match],
				)
			).map((row) => row.messageId)

		// Prefix terms, case and diacritics folded both ways.
		expect(await search(`"cafe"*`)).toEqual(["m1"])
		expect(await search(`"RESUME"*`)).toEqual(["m2"])
		expect(await search(`"meet"* "thurs"*`)).toEqual(["m1"])
		// The update and delete triggers keep the index in step.
		await object.query(`UPDATE message_search SET content = 'Lunch moved' WHERE "messageId" = 'm1'`)
		expect(await search(`"cafe"*`)).toEqual([])
		expect(await search(`"lunch"*`)).toEqual(["m3", "m1"])
		await object.query(`DELETE FROM message_search WHERE "messageId" = 'm3'`)
		expect(await search(`"lunch"*`)).toEqual(["m1"])
		// The external-content index matches its table (throws when it does not).
		await object.query(`INSERT INTO message_search_fts (message_search_fts) VALUES ('integrity-check')`)
	})

	it("adopts an org that already ran 0001_initial: 0002_message_search applies on the next run", async () => {
		const object = stub("org-upgrade")
		await object.migrate("org")
		await object.query(`DELETE FROM _migrations WHERE id = '0002_message_search'`)
		await object.query(`DROP TABLE message_search_fts`)
		await object.query(`DROP TABLE message_search`)
		await object.query(`DROP TABLE message_search_backfill`)
		expect(await object.migrate("org")).toEqual({ applied: ["0002_message_search"], failed: [] })
	})
})
