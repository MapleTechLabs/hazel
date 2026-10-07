import type { Node as ProseMirrorNode } from "prosemirror-model"
import { isSpecialMention, schema } from "./schema"

/**
 * Markdown <-> composer document, ported from the legacy
 * `slate-editor/slate-markdown-serializer.ts`. Same grammar, same output; only the
 * document model changed (ProseMirror nodes instead of Slate JSON). Framework-free.
 */

const TRUSTED_CUSTOM_EMOJI_PATH_SEGMENT = "/emojis/"

const normalizePathPrefix = (pathname: string) => (pathname.endsWith("/") ? pathname : `${pathname}/`)

/** Accept only custom emoji URLs from the configured storage base; everything else is untrusted. */
const isTrustedCustomEmojiUrl = (rawUrl: string): boolean => {
	const customEmojiStorageBaseUrl: string | undefined = import.meta.env.VITE_R2_PUBLIC_URL
	if (!customEmojiStorageBaseUrl || !URL.canParse(rawUrl) || !URL.canParse(customEmojiStorageBaseUrl)) {
		return false
	}
	const candidate = new URL(rawUrl)
	const trustedBase = new URL(customEmojiStorageBaseUrl)
	if (candidate.protocol !== "https:" && candidate.protocol !== "http:") return false
	if (candidate.origin !== trustedBase.origin) return false
	return (
		candidate.pathname.startsWith(normalizePathPrefix(trustedBase.pathname)) &&
		candidate.pathname.includes(TRUSTED_CUSTOM_EMOJI_PATH_SEGMENT)
	)
}

const MENTION_PATTERN = /@\[(userId|directive):([^\]]+)\]/g

/** Every `@[userId:…]` / `@[directive:…]` in a markdown string. */
export const extractMentionsFromMarkdown = (
	markdown: string,
): Array<{ prefix: "userId" | "directive"; value: string }> =>
	Array.from(markdown.matchAll(MENTION_PATTERN)).flatMap((match) => {
		const prefix = match[1]
		const value = match[2]
		return (prefix === "userId" || prefix === "directive") && value ? [{ prefix, value }] : []
	})

export const hasMentionPattern = (text: string): boolean => /@\[(userId|directive):([^\]]+)\]/.test(text)

const childrenOf = (node: ProseMirrorNode): ReadonlyArray<ProseMirrorNode> => {
	const children: Array<ProseMirrorNode> = []
	node.forEach((child) => children.push(child))
	return children
}

const serializeInline = (node: ProseMirrorNode) =>
	childrenOf(node)
		.map((child) => serializeToMarkdown([child]))
		.join("")

/** Composer blocks (or loose inline nodes) to the markdown sent to the backend. */
export function serializeToMarkdown(nodes: ReadonlyArray<ProseMirrorNode>): string {
	return nodes
		.map((node): string => {
			if (node.isText) return node.text ?? ""
			switch (node.type.name) {
				case "custom-emoji":
					return `![custom-emoji:${node.attrs.name}](${node.attrs.imageUrl})`
				case "mention":
					return isSpecialMention(node.attrs.userId)
						? `@[directive:${node.attrs.userId}]`
						: `@[userId:${node.attrs.userId}]`
				case "paragraph":
					return serializeInline(node)
				case "blockquote":
					return serializeInline(node)
						.split("\n")
						.map((line) => `> ${line}`)
						.join("\n")
				case "code-block":
					return `\`\`\`${node.attrs.language ?? ""}\n${node.textContent}\n\`\`\``
				case "subtext":
					return `-# ${serializeInline(node)}`
				case "list-item":
					return node.attrs.ordered ? `1. ${serializeInline(node)}` : `- ${serializeInline(node)}`
				case "table": {
					const rows = childrenOf(node)
					return rows
						.flatMap((row, rowIndex) => {
							const cells = childrenOf(row)
							const line = `| ${cells.map(serializeInline).join(" | ")} |`
							if (rowIndex !== 0) return [line]
							const separators = cells.map((cell) =>
								cell.attrs.align === "center" ? ":---:" : cell.attrs.align === "right" ? "---:" : "---",
							)
							return [line, `| ${separators.join(" | ")} |`]
						})
						.join("\n")
				}
				case "table-row":
				case "table-cell":
					return ""
				case "heading":
					return `${"#".repeat(node.attrs.level)} ${serializeInline(node)}`
				default:
					return node.textContent
			}
		})
		.join("\n")
}

type InlineNode = ProseMirrorNode

/** Mentions and trusted custom emoji become atoms; everything else stays text. */
function parseInlineContent(text: string): Array<InlineNode> {
	const nodes: Array<InlineNode> = []
	const pushText = (value: string) => {
		// ProseMirror has no empty text nodes; an empty block simply has no content.
		if (value.length > 0) nodes.push(schema.text(value))
	}
	const inlinePattern = /@\[(userId|directive):([^\]]+)\]|!\[custom-emoji:([^\]]+)\]\(([^)]+)\)/g
	let lastIndex = 0
	for (const match of text.matchAll(inlinePattern)) {
		if (match.index > lastIndex) pushText(text.slice(lastIndex, match.index))
		if (match[1] && match[2]) {
			nodes.push(schema.nodes.mention.create({ userId: match[2], displayName: match[2] }))
		} else if (match[3] && match[4]) {
			if (isTrustedCustomEmojiUrl(match[4])) {
				nodes.push(schema.nodes["custom-emoji"].create({ name: match[3], imageUrl: match[4] }))
			} else {
				// Untrusted custom emoji URLs are downgraded to shortcode text.
				pushText(`:${match[3]}:`)
			}
		}
		lastIndex = match.index + match[0].length
	}
	if (lastIndex < text.length) pushText(text.slice(lastIndex))
	return nodes
}

const isTableRow = (line: string) => line.startsWith("|") && line.endsWith("|")

const isTableSeparator = (line: string) =>
	isTableRow(line) &&
	line
		.slice(1, -1)
		.split("|")
		.every((cell) => /^\s*:?-+:?\s*$/.test(cell))

const parseAlignment = (separator: string): "left" | "center" | "right" | null => {
	const trimmed = separator.trim()
	const leftColon = trimmed.startsWith(":")
	const rightColon = trimmed.endsWith(":")
	if (leftColon && rightColon) return "center"
	if (rightColon) return "right"
	if (leftColon) return "left"
	return null
}

const parseTableRow = (line: string) =>
	line
		.slice(1, -1)
		.split("|")
		.map((cell) => cell.trim())

function parseTable(
	lines: ReadonlyArray<string>,
	startIndex: number,
): { table: ProseMirrorNode; endIndex: number } | null {
	const tableLines: Array<string> = []
	let i = startIndex
	while (i < lines.length && lines[i] && isTableRow(lines[i]!)) {
		tableLines.push(lines[i]!)
		i++
	}
	if (tableLines.length < 2 || !isTableSeparator(tableLines[1]!)) return null

	const alignments = parseTableRow(tableLines[1]!).map(parseAlignment)
	const row = (line: string, header: boolean) =>
		schema.nodes["table-row"].create(
			null,
			parseTableRow(line).map((cell, index) =>
				schema.nodes["table-cell"].create({ header, align: alignments[index] ?? null }, parseInlineContent(cell)),
			),
		)
	const table = schema.nodes.table.create(null, [
		row(tableLines[0]!, true),
		...tableLines.slice(2).map((line) => row(line, false)),
	])
	return { table, endIndex: i }
}

const block = (type: string, content: Array<InlineNode>, attrs: Record<string, unknown> | null = null) =>
	schema.node(type, attrs, content)

/** Markdown from the backend to composer blocks (for editing a message). */
export function deserializeFromMarkdown(markdown: string): Array<ProseMirrorNode> {
	if (!markdown || markdown.trim() === "") return createEmptyValue()

	const nodes: Array<ProseMirrorNode> = []
	const lines = markdown.split("\n")
	let i = 0

	while (i < lines.length) {
		const line = lines[i]
		if (!line) {
			i++
			continue
		}

		if (line.startsWith("```")) {
			const language = line.match(/^```(\w+)?/)?.[1] ?? null
			const codeLines: Array<string> = []
			i++ // opening fence
			while (i < lines.length) {
				const codeLine = lines[i]
				// Only a closing fence ends the block, never an empty line.
				if (codeLine?.startsWith("```")) break
				codeLines.push(codeLine ?? "")
				i++
			}
			i++ // closing fence
			const code = codeLines.join("\n")
			nodes.push(block("code-block", code ? [schema.text(code)] : [], { language }))
			continue
		}

		const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
		if (headingMatch) {
			nodes.push(block("heading", parseInlineContent(headingMatch[2]!), { level: headingMatch[1]!.length }))
			i++
			continue
		}

		if (isTableRow(line)) {
			const result = parseTable(lines, i)
			if (result) {
				nodes.push(result.table)
				i = result.endIndex
				continue
			}
		}

		// `>>> ` quotes the rest of the message.
		if (line.startsWith(">>> ")) {
			const restOfMessage = lines.slice(i + 1).join("\n")
			const quoteText = line.slice(4)
			nodes.push(block("blockquote", parseInlineContent(restOfMessage ? `${quoteText}\n${restOfMessage}` : quoteText)))
			break
		}

		if (line.startsWith("> ")) {
			const quoteLines: Array<string> = []
			while (i < lines.length) {
				const quoteLine = lines[i]
				if (!quoteLine || !quoteLine.startsWith("> ")) break
				quoteLines.push(quoteLine.slice(2))
				i++
			}
			nodes.push(block("blockquote", parseInlineContent(quoteLines.join("\n"))))
			continue
		}

		if (line.startsWith("-# ")) {
			nodes.push(block("subtext", parseInlineContent(line.slice(3))))
			i++
			continue
		}

		if (/^[-*] /.test(line)) {
			nodes.push(block("list-item", parseInlineContent(line.slice(2)), { ordered: false }))
			i++
			continue
		}

		if (/^\d+\. /.test(line)) {
			nodes.push(block("list-item", parseInlineContent(line.replace(/^\d+\. /, "")), { ordered: true }))
			i++
			continue
		}

		nodes.push(block("paragraph", parseInlineContent(line)))
		i++
	}

	return nodes.length > 0 ? nodes : createEmptyValue()
}

export const createEmptyValue = (): Array<ProseMirrorNode> => [schema.node("paragraph")]

/** Composer blocks as a ProseMirror document. */
export const toDoc = (blocks: ReadonlyArray<ProseMirrorNode>) => schema.node("doc", null, [...blocks])

/** Top-level blocks of a document. */
export const blocksOf = (doc: ProseMirrorNode) => childrenOf(doc)

/** True when there is nothing to send. Mentions and custom emoji count as content. */
export function isValueEmpty(nodes: ReadonlyArray<ProseMirrorNode>): boolean {
	const hasMeaningfulContent = (node: ProseMirrorNode): boolean => {
		if (node.isText) return (node.text ?? "").trim().length > 0
		if (node.type.name === "mention" || node.type.name === "custom-emoji") return true
		return childrenOf(node).some(hasMeaningfulContent)
	}
	return !nodes.some(hasMeaningfulContent)
}
