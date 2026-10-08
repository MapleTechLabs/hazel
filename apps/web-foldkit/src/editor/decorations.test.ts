import { describe, expect, it } from "vitest"
import { leafClassName, markdownLeaves } from "./decorations"

const render = (text: string) =>
	markdownLeaves(text).map((leaf) => [text.slice(leaf.start, leaf.end), leafClassName(leaf)])

describe("markdown leaves (legacy Slate decoration parity)", () => {
	it("splits **bold** like the legacy DOM, content merged as italic", () => {
		// Leaves read from the legacy capture of chat-composer-focused.
		expect(render("Draft reply with **bold** text")).toEqual([
			["Draft reply with ", ""],
			["*", "text-muted-fg/50 select-none"],
			["*", "text-muted-fg/50 select-none"],
			["bold", "italic"],
			["*", "text-muted-fg/50 select-none"],
			["*", "text-muted-fg/50 select-none"],
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

	it("leaves plain text as one undecorated leaf", () => {
		expect(render("hello")).toEqual([["hello", ""]])
	})

	it("marks plain URLs", () => {
		const leaves = markdownLeaves("see www.hazel.sh now")
		expect(leaves.find((leaf) => leaf.type === "url")).toMatchObject({ url: "https://www.hazel.sh" })
	})
})
