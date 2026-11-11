import { describe, expect, test } from "vitest"
import { viewerLeafClassName } from "../../editor/decorations"
import { codeBlockLeaves, textLeaves } from "./leaves"

/** The message viewer's leaves, now from the composer's decorations and the Prism code highlighter. */

describe("text leaves", () => {
	test("markers are hidden, content keeps its style", () => {
		expect(textLeaves("a ~~b~~").map((leaf) => [leaf.text, viewerLeafClassName(leaf)])).toEqual([
			["a ", ""],
			["~~", "hidden"],
			["b", "line-through"],
			["~~", "hidden"],
		])
	})

	test("links keep their url and text", () => {
		expect(textLeaves("see [docs](https://hazel.sh)")).toEqual([
			{ text: "see " },
			{
				text: "[docs](https://hazel.sh)",
				type: "link",
				isMarker: false,
				url: "https://hazel.sh",
				linkText: "docs",
			},
		])
	})

	test("an emoji with a shortcode is its own leaf", () => {
		const leaves = textLeaves("hi 👍")
		expect(leaves.map((leaf) => leaf.text)).toEqual(["hi ", "👍"])
		expect(leaves[1]).toMatchObject({ type: "emoji", emoji: "👍" })
		expect(leaves[1]?.shortcode).toBeTruthy()
	})
})

describe("code block leaves", () => {
	test("a known language is split into Prism tokens", () => {
		const leaves = codeBlockLeaves("const x = 1", "typescript")
		expect(leaves.map((leaf) => leaf.text).join("")).toBe("const x = 1")
		expect(leaves.find((leaf) => leaf.text === "const")?.tokenClass).toBe("token keyword")
	})

	test("every language the legacy loader knew has a grammar, aliases included", () => {
		for (const language of ["php", "rust", "rs", "yml", "md", "rb", "go", "tsx", "sql", "kotlin"])
			expect(codeBlockLeaves("x = 1", language)[0]?.tokenClass, language).toMatch(/^token/)
	})

	test("no language is Prism plaintext; an unknown one is one unstyled leaf", () => {
		expect(codeBlockLeaves("x = 1", null)).toEqual([{ text: "x = 1", tokenClass: "token" }])
		expect(codeBlockLeaves("x = 1", "brainfuck")).toEqual([{ text: "x = 1", tokenClass: "" }])
	})
})
