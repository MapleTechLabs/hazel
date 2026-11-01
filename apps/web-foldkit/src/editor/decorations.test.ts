import { describe, expect, it } from "vitest"
import { leafClassName, markdownLeaves } from "./decorations"

const render = (text: string) =>
	markdownLeaves(text).map((leaf) => [text.slice(leaf.start, leaf.end), leafClassName(leaf)])

describe("markdown leaves (legacy Slate decoration parity)", () => {
	it("renders **bold** as bold, not italic", () => {
		expect(render("Draft reply with **bold** text")).toEqual([
			["Draft reply with ", ""],
			["**", "text-muted-fg/50 select-none"],
			["bold", "font-bold"],
			["**", "text-muted-fg/50 select-none"],
			[" text", ""],
		])
	})

	it("styles inline code and underscores", () => {
		expect(render("a `b` _c_")).toEqual([
			["a ", ""],
			["`", "text-muted-fg/50 select-none"],
			["b", "bg-accent/50 rounded px-1 py-0.5 font-mono text-sm"],
			["`", "text-muted-fg/50 select-none"],
			[" ", ""],
			["_", "text-muted-fg/50 select-none"],
			["c", "italic"],
			["_", "text-muted-fg/50 select-none"],
		])
	})

	it("keeps a bold run spanning punctuation bold", () => {
		const leaves = render("**electric-sync — 61.8%** errors, *very* low")
		expect(leaves).toContainEqual(["electric-sync — 61.8%", "font-bold"])
		expect(leaves).toContainEqual(["very", "italic"])
		expect(leaves).toContainEqual([" errors, ", ""])
	})

	it("leaves snake_case, spaced asterisks and code spans undecorated", () => {
		expect(render("maple_cli_worker")).toEqual([["maple_cli_worker", ""]])
		expect(render("2 * 3 * 4")).toEqual([["2 * 3 * 4", ""]])
		expect(render("`SELECT * FROM *t*`")).toContainEqual([
			"SELECT * FROM *t*",
			"bg-accent/50 rounded px-1 py-0.5 font-mono text-sm",
		])
	})

	it("keeps a style around an inline code span on either side of it", () => {
		const leaves = render("**before `code` after**")
		expect(leaves).toContainEqual(["before ", "font-bold"])
		expect(leaves).toContainEqual(["code", "bg-accent/50 rounded px-1 py-0.5 font-mono text-sm"])
		expect(leaves).toContainEqual([" after", "font-bold"])
	})

	it("leaves plain text as one undecorated leaf", () => {
		expect(render("hello")).toEqual([["hello", ""]])
	})

	it("marks plain URLs", () => {
		const leaves = markdownLeaves("see www.hazel.sh now")
		expect(leaves.find((leaf) => leaf.type === "url")).toMatchObject({ url: "https://www.hazel.sh" })
	})
})

describe("markdown leaves: boundaries and code spans", () => {
	it("treats letters in any script as part of a word around underscores", () => {
		expect(render("café_été_")).toEqual([["café_été_", ""]])
		expect(render("a _été_ b")).toContainEqual(["été", "italic"])
	})

	it("keeps a style whose closing marker only looked like it sat inside code", () => {
		const leaves = render("**before `**` after**")
		expect(leaves).toContainEqual(["before ", "font-bold"])
		expect(leaves).toContainEqual([" after", "font-bold"])
		expect(leaves).toContainEqual(["**", "bg-accent/50 rounded px-1 py-0.5 font-mono text-sm"])
	})
})
