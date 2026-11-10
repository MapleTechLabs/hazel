import { describe, expect, it } from "vitest"
import { labEntryPaths, labPathOf } from "./boot"
import { LAB_DESCRIPTIONS, labGroupOf, labNameOf, labPathOfFile } from "./registry"

describe("lab registry", () => {
	it("lists the entry files as paths, tests excluded", () => {
		const paths = labEntryPaths()
		expect(paths).toContain("/lab/index")
		expect(paths).toContain("/lab/customers/kit/badges")
		expect(paths.some((path) => path.endsWith(".test"))).toBe(false)
	})

	it("describes only real entries", () => {
		const paths = new Set(labEntryPaths())
		for (const path of LAB_DESCRIPTIONS.keys()) expect(paths).toContain(path)
	})

	it("maps URLs, files, names and groups", () => {
		expect(labPathOf("/lab")).toBe("index")
		expect(labPathOf("/lab/")).toBe("index")
		expect(labPathOf("/lab/customers/kit/badges")).toBe("customers/kit/badges")
		expect(labPathOf("/labs")).toBeUndefined()
		expect(labPathOf("/acme/customers")).toBeUndefined()
		expect(labPathOfFile("./entries/customers/pages/overview.ts")).toBe("/lab/customers/pages/overview")
		expect(labNameOf("/lab/customers/kit/kpi-tiles")).toBe("Kpi tiles")
		expect(labGroupOf("/lab/customers/kit/badges")).toBe("customers/kit")
		expect(labGroupOf("/lab/index")).toBe("")
	})
})
