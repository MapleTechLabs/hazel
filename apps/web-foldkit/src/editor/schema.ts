import { type DOMOutputSpec, type Node as ProseMirrorNode, Schema } from "prosemirror-model"

/**
 * The composer document model, a ProseMirror port of the legacy Slate element types
 * (`components/chat/slate-editor/types.ts`). Node names match the Slate `type` strings.
 *
 * Like the Slate editor, inline formatting is not stored as marks: blocks hold plain
 * markdown text and `decorations.ts` styles the markers. Mentions and custom emoji are
 * inline atoms. `toDOM` reproduces the legacy `renderElement` markup and classes.
 */

const MENTION_CLASS =
	"inline-block cursor-pointer rounded bg-primary/10 px-1 py-0.5 align-baseline font-medium text-primary transition-colors"

export const isSpecialMention = (userId: string) => userId === "channel" || userId === "here"

/** Legacy `MentionElement` with `interactive={false}` (composer mode). */
export const mentionClassName = (userId: string) =>
	isSpecialMention(userId) ? MENTION_CLASS : `${MENTION_CLASS} hover:bg-primary/20`

/** Slate renders a void's children as an absolutely positioned zero-width spacer. */
const voidSpacer: DOMOutputSpec = [
	"span",
	{ "data-slate-spacer": "true", style: "height: 0px; color: transparent; outline: none; position: absolute;" },
	["span", { "data-slate-zero-width": "z", "data-slate-length": "0" }, "﻿"],
]

export const schema = new Schema({
	nodes: {
		doc: { content: "block+" },
		paragraph: {
			group: "block",
			content: "inline*",
			parseDOM: [{ tag: "p" }],
			toDOM: () => ["p", { class: "my-0 min-h-6" }, 0],
		},
		blockquote: {
			group: "block",
			content: "inline*",
			defining: true,
			parseDOM: [{ tag: "blockquote" }],
			// The legacy accent bar is a widget decoration (`decorations.ts`), since a
			// toDOM content hole must be the only child of its parent.
			toDOM: () => ["blockquote", { class: "relative my-1 pl-4 italic" }, 0],
		},
		"code-block": {
			group: "block",
			content: "text*",
			code: true,
			defining: true,
			marks: "",
			attrs: { language: { default: null } },
			parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
			// Legacy `CodeBlockElement` with `showControls={false}`.
			toDOM: () => [
				"div",
				{ class: "group relative my-2" },
				[
					"pre",
					{ class: "overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-4 pr-24 font-mono text-sm" },
					["code", 0],
				],
			],
		},
		subtext: {
			group: "block",
			content: "inline*",
			toDOM: () => ["p", { class: "my-0 text-muted-fg text-xs" }, 0],
		},
		"list-item": {
			group: "block",
			content: "inline*",
			attrs: { ordered: { default: false } },
			toDOM: () => ["li", { class: "my-0.5 ml-4" }, 0],
		},
		// The legacy composer's `renderElement` has no heading or table case, so they fall
		// through to a bare `<p>`.
		heading: {
			group: "block",
			content: "inline*",
			attrs: { level: { default: 1 } },
			toDOM: () => ["p", 0],
		},
		table: { group: "block", content: "tableRow+", toDOM: () => ["p", 0] },
		"table-row": { group: "tableRow", content: "tableCell+", toDOM: () => ["p", 0] },
		"table-cell": {
			group: "tableCell",
			content: "inline*",
			attrs: { header: { default: false }, align: { default: null } },
			toDOM: () => ["p", 0],
		},
		mention: {
			group: "inline",
			inline: true,
			atom: true,
			attrs: { userId: {}, displayName: {} },
			toDOM: (node) => [
				"span",
				{ contenteditable: "false", class: mentionClassName(node.attrs.userId) },
				`@${node.attrs.displayName}`,
				voidSpacer,
			],
		},
		"custom-emoji": {
			group: "inline",
			inline: true,
			atom: true,
			attrs: { name: {}, imageUrl: {} },
			toDOM: (node) => [
				"span",
				{ contenteditable: "false", role: "button" },
				[
					"img",
					{
						src: node.attrs.imageUrl,
						alt: `:${node.attrs.name}:`,
						class: "inline-block size-5 align-text-bottom",
					},
				],
				voidSpacer,
			],
		},
		text: { group: "inline" },
	},
	marks: {},
})

export type NodeTypeName =
	| "paragraph"
	| "blockquote"
	| "code-block"
	| "subtext"
	| "list-item"
	| "heading"
	| "table"
	| "table-row"
	| "table-cell"
	| "mention"
	| "custom-emoji"

export type { ProseMirrorNode }
