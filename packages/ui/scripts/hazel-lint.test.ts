import { spawnSync } from "node:child_process"
import { rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/** `hazel/no-raw-escape` (`scripts/oxlint-plugins/hazel.mjs`) against a file planted in a shared screen. */
const root = resolve(import.meta.dirname, "../../..")
const lint = (path: string) =>
	spawnSync("bunx", ["oxlint", "--disable-nested-config", "--quiet", path], { cwd: root, encoding: "utf8" })

const plant = (name: string, source: string) => {
	const path = resolve(root, "apps/shared-screens/src", name)
	writeFileSync(path, source)
	return path
}

describe("hazel/no-raw-escape", () => {
	it("fails on each raw escape planted in a shared screen", () => {
		const path = plant(
			"__planted_escape__.ts",
			[
				'import { Html } from "@effect/ui/html"',
				'import { Hazel } from "@hazel/ui/vocabulary/index"',
				"export const planted = (h: any) => [",
				'\th.item.attr("class", "p-4"),',
				'\th.item.attrs({ style: "color: red" }),',
				'\th.item.prop("color", "red"),',
				'\th.el("div"),',
				"\tHazel.extension({} as never),",
				"\tHtml,",
				"]",
				"",
			].join("\n"),
		)
		try {
			const result = lint(path)
			expect(result.status).not.toBe(0)
			const hits = result.stdout.split("\n").filter((line) => line.includes("hazel(no-raw-escape)"))
			expect(hits).toHaveLength(6)
		} finally {
			rmSync(path)
		}
	}, 30_000)

	it("passes a screen that uses only typed props", () => {
		const path = plant(
			"__planted_clean__.ts",
			'import type { Hazel } from "@hazel/ui/vocabulary/index"\nexport const ok = (h: Hazel.H<"m">) => h.item.title("x").badge(2)\n',
		)
		try {
			expect(lint(path).status).toBe(0)
		} finally {
			rmSync(path)
		}
	}, 30_000)
})
