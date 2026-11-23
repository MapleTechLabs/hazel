import { describe, expect, test } from "vitest"
import { fileViolations, migrationViolations, type MigrationsByStore } from "./append-only.ts"

const base: MigrationsByStore = {
	org: [
		{ id: "0001_initial", statements: ["CREATE TABLE a (id text)"] },
		{ id: "0002_b", statements: ["ALTER TABLE a ADD COLUMN b text"] },
	],
	user: [{ id: "0001_initial", statements: ["CREATE TABLE u (id text)"] }],
}

describe("migrationViolations", () => {
	test("appending migrations and stores is fine", () => {
		const head: MigrationsByStore = {
			...base,
			org: [...base.org!, { id: "0003_c", statements: ["CREATE INDEX c ON a (b)"] }],
			channel: [{ id: "0001_initial", statements: ["CREATE TABLE m (id text)"] }],
		}
		expect(migrationViolations(base, head)).toEqual([])
	})

	test("an edited statement is a modification", () => {
		const head: MigrationsByStore = {
			...base,
			org: [base.org![0]!, { id: "0002_b", statements: ["ALTER TABLE a ADD COLUMN b integer"] }],
		}
		expect(migrationViolations(base, head)).toEqual(["org/0002_b: modified"])
	})

	test("an added statement, or a changed optional flag, is a modification", () => {
		const head: MigrationsByStore = {
			...base,
			user: [{ ...base.user![0]!, statements: [...base.user![0]!.statements, "SELECT 1"] }],
			org: [{ ...base.org![0]!, optional: true }, base.org![1]!],
		}
		expect(migrationViolations(base, head)).toEqual([
			"org/0001_initial: modified",
			"user/0001_initial: modified",
		])
	})

	test("removals, of a migration or a store, are reported", () => {
		expect(migrationViolations(base, { org: [base.org![0]!] })).toEqual([
			"org/0002_b: removed",
			"user: the store's migrations were removed",
		])
	})

	test("inserting before a committed migration moves it", () => {
		const head: MigrationsByStore = {
			...base,
			org: [base.org![0]!, { id: "0002_new", statements: [] }, base.org![1]!],
		}
		expect(migrationViolations(base, head)).toEqual([
			"org/0002_b: moved (expected at position 2, found 0002_new there)",
		])
	})
})

describe("fileViolations", () => {
	const dir = "packages/db/migrations/directory"
	const files = new Map([
		[`${dir}/0001_initial/migration.sql`, "aaa"],
		[`${dir}/0002_b/migration.sql`, "bbb"],
	])

	test("new files after the last one are fine", () => {
		const head = new Map<string, string | undefined>([...files, [`${dir}/0003_c/migration.sql`, "ccc"]])
		expect(fileViolations(files, head)).toEqual([])
	})

	test("modified, removed and out-of-order files are reported", () => {
		const head = new Map<string, string | undefined>([
			[`${dir}/0001_initial/migration.sql`, "changed"],
			[`${dir}/0002_b/migration.sql`, undefined],
			[`${dir}/0001_late/migration.sql`, "ddd"],
		])
		expect(fileViolations(files, head)).toEqual([
			`${dir}/0001_initial/migration.sql: modified`,
			`${dir}/0002_b/migration.sql: removed`,
			`${dir}/0001_late/migration.sql: added before ${dir}/0002_b/migration.sql; number it after the last committed migration`,
		])
	})
})
