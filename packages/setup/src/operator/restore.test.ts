import { describe, expect, it } from "vitest"
import {
	confirmationWord,
	directoryCommand,
	objectRequest,
	parseRestoreArgs,
	type RestorePlan,
} from "./restore"

const now = Date.parse("2026-11-23T12:00:00.000Z")
const id = "0B7C8F8E-4A71-4D2E-9A43-0C7C4B0F8A11"
const at = "2026-11-20T09:00:00Z"

const planOf = (argv: Array<string>): RestorePlan => {
	const result = parseRestoreArgs(argv, now)
	if (result._tag !== "Plan") throw new Error(`expected a plan, got ${JSON.stringify(result)}`)
	return result.plan
}

const invalid = (argv: Array<string>) => {
	const result = parseRestoreArgs(argv, now)
	return result._tag === "Invalid" ? result.message : undefined
}

describe("parseRestoreArgs", () => {
	it("parses an object restore", () => {
		expect(
			planOf(["--api", "https://api.chat.acme.com/", "--kind", "org", "--id", id, "--at", at]),
		).toEqual({
			_tag: "Object",
			api: "https://api.chat.acme.com",
			kind: "org",
			id: id.toLowerCase(),
			at: "2026-11-20T09:00:00.000Z",
			dryRun: false,
			yes: false,
		})
	})

	it("parses a dry run and --yes, and epoch milliseconds", () => {
		const plan = planOf([
			"--api",
			"https://api.chat.acme.com",
			"--kind",
			"channel",
			"--id",
			id,
			"--at",
			String(now - 60_000),
			"--dry-run",
			"-y",
		])
		expect(plan).toMatchObject({
			kind: "channel",
			dryRun: true,
			yes: true,
			at: new Date(now - 60_000).toISOString(),
		})
	})

	it("parses a directory restore by database or customer name", () => {
		expect(planOf(["--kind", "directory", "--db", "hazel-directory-acme", "--at", at])).toEqual({
			_tag: "Directory",
			database: "hazel-directory-acme",
			at: "2026-11-20T09:00:00.000Z",
			dryRun: false,
			yes: false,
		})
		expect(planOf(["--kind", "directory", "--customer", "acme", "--at", at, "--dry-run"])).toMatchObject({
			database: "hazel-directory-acme",
			dryRun: true,
		})
	})

	it("refuses incomplete or invalid arguments", () => {
		expect(invalid(["--api", "https://api.x", "--id", id, "--at", at])).toMatch(/--kind/)
		expect(invalid(["--api", "https://api.x", "--kind", "org", "--id", id])).toMatch(/--at/)
		expect(invalid(["--api", "https://api.x", "--kind", "workspace", "--id", id, "--at", at])).toMatch(
			/--kind/,
		)
		expect(invalid(["--api", "https://api.x", "--kind", "org", "--id", "acme", "--at", at])).toMatch(
			/--id/,
		)
		expect(invalid(["--kind", "org", "--id", id, "--at", at])).toMatch(/--api/)
		expect(invalid(["--api", "not a url", "--kind", "org", "--id", id, "--at", at])).toMatch(/not a URL/)
		expect(invalid(["--api", "http://api.x", "--kind", "org", "--id", id, "--at", at])).toMatch(/https/)
		expect(invalid(["--kind", "directory", "--at", at])).toMatch(/--db/)
		expect(invalid(["--kind", "directory", "--db", "a", "--customer", "b", "--at", at])).toMatch(
			/not both/,
		)
		expect(invalid(["--kind", "directory", "--db", "bad name; rm", "--at", at])).toMatch(/--db/)
		expect(invalid(["--kind", "org", "--unknown"])).toBeDefined()
	})

	it("refuses times in the future or older than 30 days", () => {
		const base = ["--api", "https://api.x", "--kind", "org", "--id", id, "--at"]
		expect(invalid([...base, "2026-11-24T00:00:00Z"])).toMatch(/30 days/)
		expect(invalid([...base, "2026-10-01T00:00:00Z"])).toMatch(/30 days/)
		expect(invalid([...base, "yesterday"])).toMatch(/30 days/)
	})

	it("answers help", () => {
		expect(parseRestoreArgs(["--help"], now)).toEqual({ _tag: "Help" })
	})
})

describe("requests", () => {
	it("a dry run looks the bookmark up, a restore posts it", () => {
		const plan = planOf([
			"--api",
			"https://api.x.com",
			"--kind",
			"user",
			"--id",
			id,
			"--at",
			at,
			"--dry-run",
		])
		if (plan._tag !== "Object") throw new Error("expected an object plan")
		const lookup = objectRequest(plan, "tok")
		expect(lookup.init.method).toBe("GET")
		expect(lookup.url).toBe(
			`https://api.x.com/internal/operator/bookmark?kind=user&id=${id.toLowerCase()}&timestamp=2026-11-20T09%3A00%3A00.000Z`,
		)
		expect(lookup.init.headers).toEqual({ authorization: "Bearer tok" })
		const restore = objectRequest({ ...plan, dryRun: false }, "tok")
		expect(restore.url).toBe("https://api.x.com/internal/operator/restore")
		expect(restore.init.method).toBe("POST")
		expect(JSON.parse(String(restore.init.body))).toEqual({
			kind: "user",
			id: id.toLowerCase(),
			timestamp: "2026-11-20T09:00:00.000Z",
		})
		expect(confirmationWord(plan)).toBe(id.toLowerCase())
	})

	it("a directory plan runs wrangler time-travel info or restore", () => {
		const plan = planOf(["--kind", "directory", "--customer", "acme", "--at", at])
		if (plan._tag !== "Directory") throw new Error("expected a directory plan")
		expect(directoryCommand(plan)).toEqual([
			"bunx",
			"wrangler",
			"d1",
			"time-travel",
			"restore",
			"hazel-directory-acme",
			"--timestamp",
			"2026-11-20T09:00:00.000Z",
		])
		expect(directoryCommand({ ...plan, dryRun: true })[4]).toBe("info")
		expect(confirmationWord(plan)).toBe("hazel-directory-acme")
	})
})
