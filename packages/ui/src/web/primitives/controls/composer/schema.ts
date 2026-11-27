/**
 * The composer's document (W12b), ported from `apps/web-foldkit/src/editor/schema.ts`. Blocks hold
 * plain markdown text (`decorations.ts` styles the markers); mentions and custom emoji are inline
 * atoms. `toDOM` writes `data-hz-part` names only: `composer-styles.ts` draws them from tokens.
 */
import { Schema } from "prosemirror-model"

/** `@here` and `@channel`: directives, not users. */
export const isDirective = (id: string) => id === "channel" || id === "here"

export const schema = new Schema({
	nodes: {
		doc: { content: "block+" },
		paragraph: {
			group: "block",
			content: "inline*",
			parseDOM: [{ tag: "p" }],
			toDOM: () => ["p", { "data-hz-part": "paragraph" }, 0],
		},
		blockquote: {
			group: "block",
			content: "inline*",
			defining: true,
			parseDOM: [{ tag: "blockquote" }],
			toDOM: () => ["blockquote", { "data-hz-part": "quote" }, 0],
		},
		"code-block": {
			group: "block",
			content: "text*",
			code: true,
			defining: true,
			marks: "",
			attrs: { language: { default: null } },
			parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
			toDOM: () => ["pre", { "data-hz-part": "codeBlock" }, ["code", 0]],
		},
		subtext: {
			group: "block",
			content: "inline*",
			toDOM: () => ["p", { "data-hz-part": "subtext" }, 0],
		},
		"list-item": {
			group: "block",
			content: "inline*",
			// `number` is an ordered item's number in the markdown, so a list starting at 5 shows 5.
			attrs: { ordered: { default: false }, number: { default: null } },
			toDOM: (node) => [
				"li",
				node.attrs.ordered === true
					? { "data-hz-part": "listItem", "data-number": String(node.attrs.number ?? 1) }
					: { "data-hz-part": "listItem" },
				0,
			],
		},
		// Today's composer draws headings and tables as plain paragraphs; the markdown keeps them.
		heading: {
			group: "block",
			content: "inline*",
			attrs: { level: { default: 1 } },
			toDOM: () => ["p", { "data-hz-part": "paragraph" }, 0],
		},
		table: { group: "block", content: "tableRow+", toDOM: () => ["div", 0] },
		"table-row": { group: "tableRow", content: "tableCell+", toDOM: () => ["div", 0] },
		"table-cell": {
			group: "tableCell",
			content: "inline*",
			attrs: { header: { default: false }, align: { default: null } },
			toDOM: () => ["p", { "data-hz-part": "paragraph" }, 0],
		},
		mention: {
			group: "inline",
			inline: true,
			atom: true,
			// `kind`: `user`, `group` (a user group) or `directive` (`here`, `channel`).
			attrs: { id: {}, kind: { default: "user" } },
			toDOM: (node) => [
				"span",
				{ "data-hz-part": "mention", "data-id": node.attrs.id, contenteditable: "false" },
				`@${node.attrs.id}`,
			],
		},
		"custom-emoji": {
			group: "inline",
			inline: true,
			atom: true,
			attrs: { name: {}, url: {} },
			toDOM: (node) => [
				"img",
				{
					"data-hz-part": "customEmoji",
					src: node.attrs.url,
					alt: `:${node.attrs.name}:`,
					contenteditable: "false",
				},
			],
		},
		text: { group: "inline" },
	},
	marks: {},
})
