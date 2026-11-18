import { describe, expect, it } from "vitest"
import { databaseFileName, splitStatements, toBindable } from "./local-cache"

describe("splitStatements", () => {
	it("splits a script at each statement's end", () => {
		expect(splitStatements("SELECT 1; SELECT 2 ;\n SELECT 3")).toEqual([
			"SELECT 1",
			" SELECT 2 ",
			"\n SELECT 3",
		])
		expect(splitStatements("SELECT 1")).toEqual(["SELECT 1"])
		expect(splitStatements("SELECT 1;")).toEqual(["SELECT 1"])
	})

	it("ends nothing inside a string, a quoted name or a comment", () => {
		const statements = [
			"SELECT ';' AS a, 'it''s; fine' AS b",
			` INSERT INTO "odd;name" ([a;b], \`c;d\`) VALUES (1, 2) -- not; here\n`,
			" SELECT /* nor; here */ 3",
		]
		expect(splitStatements(statements.join(";"))).toEqual(statements)
	})

	it("leaves out text with no statement in it", () => {
		expect(splitStatements("")).toEqual([])
		expect(splitStatements(" ;; -- only a comment\n ; /* and another */ ")).toEqual([])
	})

	it("keeps a trigger whole, to the semicolon after its END", () => {
		const trigger = `CREATE TRIGGER IF NOT EXISTS "t_insert" AFTER INSERT ON t
			BEGIN
				UPDATE v SET n = n + 1 WHERE id = NEW.id;
				DELETE FROM w WHERE id = NEW.id;
			END`
		expect(splitStatements(trigger)).toEqual([trigger])
		expect(splitStatements(`${trigger}; SELECT 1`)).toEqual([trigger, " SELECT 1"])
		const temporary = "create temp trigger x after delete on t begin select 1; end"
		expect(splitStatements(`${temporary};${temporary}`)).toEqual([temporary, temporary])
		// A table named like a trigger's keyword is no trigger.
		expect(splitStatements("CREATE TABLE trigger_log (a); SELECT 1")).toEqual([
			"CREATE TABLE trigger_log (a)",
			" SELECT 1",
		])
	})
})

describe("toBindable", () => {
	it("does not take a CASE expression's END for the trigger's", () => {
		const trigger = `CREATE TRIGGER tr AFTER INSERT ON t BEGIN
  SELECT CASE WHEN 1 THEN CASE WHEN 2 THEN 3 END ELSE 4 END;
  SELECT 3;
END`
		expect(splitStatements(`${trigger}; SELECT 1`)).toEqual([trigger, " SELECT 1"])
	})

	it("converts parameters as the OPFS worker does", () => {
		expect(toBindable(undefined)).toBe(null)
		expect(toBindable(null)).toBe(null)
		expect(toBindable("a")).toBe("a")
		expect(toBindable(1.5)).toBe(1.5)
		expect(toBindable(Number.NaN)).toBe(null)
		expect(toBindable(Number.POSITIVE_INFINITY)).toBe(null)
		expect(toBindable(12n)).toBe(12n)
		expect(toBindable(true)).toBe(1)
		expect(toBindable(false)).toBe(0)
		expect(toBindable(new Date(0))).toBe("1970-01-01T00:00:00.000Z")
		expect(toBindable(new Uint8Array([1]))).toEqual(new Uint8Array([1]))
		expect(toBindable([1, 2])).toEqual(new Uint8Array([1, 2]))
		expect(() => toBindable({ a: 1 })).toThrow("Unsupported parameter type")
		expect(() => toBindable(["a"])).toThrow("Unsupported parameter type")
	})
})

describe("databaseFileName", () => {
	it("takes the cache's own names", () => {
		for (const name of [
			"hazel-cache-usr_01JABC.sqlite",
			"hazel-cache-0b9f4a1e-77aa-4c1d-9a51-2f6f1c0e9d11.sqlite",
		])
			expect(databaseFileName(name)).toBe(name)
	})

	it("refuses a name that could leave the folder or meet another file", () => {
		for (const name of [
			"",
			".sqlite",
			"../x.sqlite",
			"a/b.sqlite",
			"a\\b.sqlite",
			"a b.sqlite",
			"x.sqlite-wal",
			"local-storage.json",
			"x\u0000.sqlite",
			`${"a".repeat(200)}.sqlite`,
		])
			expect(() => databaseFileName(name)).toThrow("no local cache database name")
	})
})
