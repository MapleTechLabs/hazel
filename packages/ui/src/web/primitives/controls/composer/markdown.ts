/**
 * Markdown to and from the composer's document (W12b), ported from
 * `apps/web-foldkit/src/editor/markdown.ts`: the same grammar and output. Mentions are
 * `@[userId:id]`, `@[group:id]` or `@[directive:id]`; custom emoji `![custom-emoji:name](url)`.
 */
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { isDirective, schema } from "./schema.ts"

let trustedEmojiBase: URL | undefined

/**
 * The storage base custom emoji load from (today's `currentServer().cdn`). Until the app sets it, only
 * `data:image/` urls draw as emoji; any other `![custom-emoji:...]` reads as its `:name:` text.
 */
export const trustCustomEmojiBase = (base: string | undefined) => {
	trustedEmojiBase = base !== undefined && URL.canParse(base) ? new URL(base) : undefined
}

const withSlash = (path: string) => (path.endsWith("/") ? path : `${path}/`)

const isTrustedEmojiUrl = (raw: string): boolean => {
	if (raw.startsWith("data:image/")) return true
	if (trustedEmojiBase === undefined || !URL.canParse(raw)) return false
	const url = new URL(raw)
	return (
		(url.protocol === "https:" || url.protocol === "http:") &&
		url.origin === trustedEmojiBase.origin &&
		url.pathname.startsWith(withSlash(trustedEmojiBase.pathname)) &&
		url.pathname.includes("/emojis/")
	)
}

const childrenOf = (node: ProseMirrorNode): ReadonlyArray<ProseMirrorNode> => {
	const children: Array<ProseMirrorNode> = []
	node.forEach((child) => children.push(child))
	return children
}

const inline = (node: ProseMirrorNode) => childrenOf(node).map(serializeNode).join("")

const table = (node: ProseMirrorNode) =>
	childrenOf(node)
		.flatMap((row, index) => {
			const cells = childrenOf(row)
			const line = `| ${cells.map(inline).join(" | ")} |`
			if (index !== 0) return [line]
			const rule = cells.map((cell) =>
				cell.attrs.align === "center" ? ":---:" : cell.attrs.align === "right" ? "---:" : "---",
			)
			return [line, `| ${rule.join(" | ")} |`]
		})
		.join("\n")

const mention = (node: ProseMirrorNode) =>
	node.attrs.kind === "group"
		? `@[group:${node.attrs.id}]`
		: node.attrs.kind === "directive" || isDirective(node.attrs.id)
			? `@[directive:${node.attrs.id}]`
			: `@[userId:${node.attrs.id}]`

const serializers = new Map<string, (node: ProseMirrorNode) => string>([
	["custom-emoji", (node) => `![custom-emoji:${node.attrs.name}](${node.attrs.url})`],
	["mention", mention],
	["paragraph", inline],
	[
		"blockquote",
		(node) =>
			inline(node)
				.split("\n")
				.map((line) => `> ${line}`)
				.join("\n"),
	],
	["code-block", (node) => `\`\`\`${node.attrs.language ?? ""}\n${node.textContent}\n\`\`\``],
	["subtext", (node) => `-# ${inline(node)}`],
	[
		"list-item",
		(node) => (node.attrs.ordered ? `${node.attrs.number ?? 1}. ${inline(node)}` : `- ${inline(node)}`),
	],
	["table", table],
	["heading", (node) => `${"#".repeat(node.attrs.level)} ${inline(node)}`],
])

const serializeNode = (node: ProseMirrorNode): string =>
	node.isText ? (node.text ?? "") : (serializers.get(node.type.name)?.(node) ?? node.textContent)

/** The document as the markdown a message sends. */
export const toMarkdown = (doc: ProseMirrorNode): string => childrenOf(doc).map(serializeNode).join("\n")

const inlinePattern = /@\[(userId|directive|group):([^\]]+)\]|!\[custom-emoji:([^\]]+)\]\(([^)]+)\)/g

/** Mentions and trusted custom emoji become atoms; everything else stays text. */
const parseInline = (text: string): Array<ProseMirrorNode> => {
	const nodes: Array<ProseMirrorNode> = []
	const pushText = (value: string) => {
		if (value.length > 0) nodes.push(schema.text(value))
	}
	let last = 0
	for (const match of text.matchAll(inlinePattern)) {
		pushText(text.slice(last, match.index))
		const [, kind, id, name, url] = match
		if (kind !== undefined && id !== undefined)
			nodes.push(schema.nodes.mention.create({ id, kind: kind === "userId" ? "user" : kind }))
		else if (name !== undefined && url !== undefined) {
			if (isTrustedEmojiUrl(url)) nodes.push(schema.nodes["custom-emoji"].create({ name, url }))
			else pushText(`:${name}:`)
		}
		last = match.index + match[0].length
	}
	pushText(text.slice(last))
	return nodes
}

const isTableRow = (line: string) => line.startsWith("|") && line.endsWith("|")
const cellsOf = (line: string) =>
	line
		.slice(1, -1)
		.split("|")
		.map((cell) => cell.trim())
const isTableRule = (line: string) => isTableRow(line) && cellsOf(line).every((cell) => /^:?-+:?$/.test(cell))
const alignOf = (rule: string) =>
	rule.startsWith(":") && rule.endsWith(":")
		? "center"
		: rule.endsWith(":")
			? "right"
			: rule.startsWith(":")
				? "left"
				: null

const parseTable = (lines: ReadonlyArray<string>, start: number) => {
	let end = start
	while (end < lines.length && isTableRow(lines[end] ?? "")) end++
	const [head = "", rule = "", ...body] = lines.slice(start, end)
	if (end - start < 2 || !isTableRule(rule)) return undefined
	const aligns = cellsOf(rule).map(alignOf)
	const row = (line: string, header: boolean) =>
		schema.nodes["table-row"].create(
			null,
			cellsOf(line).map((cell, index) =>
				schema.nodes["table-cell"].create(
					{ header, align: aligns[index] ?? null },
					parseInline(cell),
				),
			),
		)
	const node = schema.nodes.table.create(null, [row(head, true), ...body.map((line) => row(line, false))])
	return { node, end }
}

const block = (type: string, content: Array<ProseMirrorNode>, attrs: Record<string, unknown> | null = null) =>
	schema.node(type, attrs, content)

/** Markdown (a draft, or a message being edited) as the composer's document. */
export const fromMarkdown = (markdown: string): ProseMirrorNode => {
	const nodes: Array<ProseMirrorNode> = []
	const lines = markdown.split("\n")
	let i = 0
	while (i < lines.length) {
		const line = lines[i] ?? ""
		// A blank line is an empty paragraph, so `toMarkdown(fromMarkdown(text))` is `text` and a Model
		// edit replaces only what it changed (today's composer dropped them on load).
		if (line.trim() === "") {
			nodes.push(block("paragraph", line === "" ? [] : [schema.text(line)]))
			i++
			continue
		}
		if (line.startsWith("```")) {
			const language = /^```(\w+)?/.exec(line)?.[1] ?? null
			const code: Array<string> = []
			i++
			// Only a closing fence ends the block, never an empty line.
			while (i < lines.length && !(lines[i] ?? "").startsWith("```")) code.push(lines[i++] ?? "")
			i++
			const text = code.join("\n")
			nodes.push(block("code-block", text === "" ? [] : [schema.text(text)], { language }))
			continue
		}
		const [, hashes, title] = /^(#{1,3})\s+(.+)$/.exec(line) ?? []
		if (hashes !== undefined && title !== undefined) {
			nodes.push(block("heading", parseInline(title), { level: hashes.length }))
			i++
			continue
		}
		if (isTableRow(line)) {
			const parsed = parseTable(lines, i)
			if (parsed !== undefined) {
				nodes.push(parsed.node)
				i = parsed.end
				continue
			}
		}
		// `>>> ` quotes the rest of the message.
		if (line.startsWith(">>> ")) {
			const rest = lines.slice(i + 1).join("\n")
			nodes.push(
				block("blockquote", parseInline(rest === "" ? line.slice(4) : `${line.slice(4)}\n${rest}`)),
			)
			break
		}
		if (line.startsWith("> ")) {
			const quote: Array<string> = []
			while (i < lines.length && (lines[i] ?? "").startsWith("> "))
				quote.push((lines[i++] ?? "").slice(2))
			nodes.push(block("blockquote", parseInline(quote.join("\n"))))
			continue
		}
		const ordered = /^(\d+)\. /.exec(line)
		if (line.startsWith("-# ")) nodes.push(block("subtext", parseInline(line.slice(3))))
		else if (/^[-*] /.test(line))
			nodes.push(block("list-item", parseInline(line.slice(2)), { ordered: false }))
		else if (ordered !== null)
			nodes.push(
				block("list-item", parseInline(line.slice(ordered[0].length)), {
					ordered: true,
					number: Number(ordered[1]),
				}),
			)
		else nodes.push(block("paragraph", parseInline(line)))
		i++
	}
	if (nodes.length === 0) nodes.push(block("paragraph", []))
	return schema.node("doc", null, nodes)
}

/** Nothing to send: no text but whitespace, and no mention or custom emoji. */
export const isEmpty = (doc: ProseMirrorNode): boolean => {
	let empty = true
	doc.descendants((node) => {
		if (!empty) return false
		if (node.isText ? (node.text ?? "").trim() !== "" : node.isAtom && node.isInline) empty = false
		return empty
	})
	return empty
}
