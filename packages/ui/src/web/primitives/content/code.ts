/**
 * Prism highlighting for `codeBlock` and `richText` code blocks, through the web app's own tokenizer
 * (`editor/code-highlight.ts`, every grammar registered up front). Each run is a span marked with the
 * ink group today's `code-syntax.css` gives its token types; `styles.ts` colours the groups.
 */
import { codeLeaves } from "../../../../../../apps/web-foldkit/src/editor/code-highlight.ts"

/** `code-syntax.css`'s rules in file order: when a run has several types, the later rule wins. */
const groups: ReadonlyArray<readonly [group: string, types: ReadonlyArray<string>]> = [
	["comment", ["comment", "prolog", "doctype", "cdata"]],
	["punctuation", ["punctuation"]],
	["namespace", ["namespace"]],
	["constant", ["property", "tag", "boolean", "number", "constant", "symbol", "deleted"]],
	["string", ["selector", "attr-name", "string", "char", "builtin", "inserted"]],
	["operator", ["operator", "entity", "url"]],
	["keyword", ["atrule", "attr-value", "keyword"]],
	["function", ["function", "class-name"]],
	["variable", ["regex", "important", "variable"]],
]

const groupOf = (types: ReadonlyArray<string>, language: string) => {
	let found: string | undefined
	for (const [group, members] of groups) if (types.some((type) => members.includes(type))) found = group
	// `.language-css .token.string` takes the operator ink.
	return found === "string" && language === "css" ? "operator" : found
}

/** The code as text nodes and marked spans, ready to append under a `code` element. */
export const highlight = (document: Document, code: string, language: string): ReadonlyArray<Node> =>
	codeLeaves(code, language === "" ? null : language).map((leaf) => {
		if (leaf.tokenTypes === null || leaf.tokenTypes.length === 0)
			return document.createTextNode(leaf.text)
		const span = document.createElement("span")
		const group = groupOf(leaf.tokenTypes, language.toLowerCase())
		if (group !== undefined) span.dataset.syntax = group
		if (leaf.tokenTypes.includes("important") || leaf.tokenTypes.includes("bold")) span.dataset.bold = ""
		if (leaf.tokenTypes.includes("italic")) span.dataset.italic = ""
		span.textContent = leaf.text
		return span
	})
