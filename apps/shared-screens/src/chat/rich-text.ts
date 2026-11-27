/**
 * A message's markdown as `richText` blocks (`content.ts`), the subset today's viewer draws
 * (`web-foldkit/src/chat/markdown`): paragraphs, fenced code, list items, quotes; mentions, links,
 * inline code, bold, italic and strikethrough. Marks do not nest: the outermost one wins.
 */
import { BlockKind, type Block, type Run, RunKind } from "@hazel/ui/vocabulary/content"

/** What the body names outside the markdown: users and groups by id. */
export interface Names {
	readonly user: (userId: string) => string | undefined
	readonly group: (groupId: string) => string | undefined
}

const INLINE =
	/@\[userId:([^\]]+)\]|@\[group:([^\]]+)\]|@\[directive:([^\]]+)\]|!\[custom-emoji:([^\]]+)\]\([^)]*\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"])|`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|(?<![\w*])\*([^*\n]+)\*(?!\w)|(?<!\w)_([^_\n]+)_(?!\w)/g

/** One line's (or paragraph's) runs. */
export const runsOf = (text: string, names: Names): ReadonlyArray<Run> => {
	const out: Array<Run> = []
	let at = 0
	const plain = (value: string) => {
		if (value === "") return
		const last = out.at(-1)
		if (typeof last === "string") out[out.length - 1] = last + value
		else out.push(value)
	}
	for (const match of text.matchAll(INLINE)) {
		plain(text.slice(at, match.index))
		const [whole, user, group, directive, emoji, label, href, url, code, bold, bold2, strike, em, em2] =
			match
		if (user !== undefined) out.push([RunKind.mention, `@${names.user(user) ?? "unknown"}`, user])
		else if (group !== undefined)
			out.push([RunKind.mention, `@${names.group(group) ?? "group"}`, `group:${group}`])
		else if (directive !== undefined)
			out.push([RunKind.mention, `@${directive}`, `directive:${directive}`])
		else if (emoji !== undefined) plain(`:${emoji}:`)
		else if (label !== undefined && href !== undefined) out.push([RunKind.link, label, href])
		else if (url !== undefined) out.push([RunKind.link, url, url])
		else if (code !== undefined) out.push([RunKind.code, code])
		else if ((bold ?? bold2) !== undefined) out.push([RunKind.strong, bold ?? bold2 ?? ""])
		else if (strike !== undefined) out.push([RunKind.strike, strike])
		else if ((em ?? em2) !== undefined) out.push([RunKind.emphasis, em ?? em2 ?? ""])
		else plain(whole)
		at = match.index + whole.length
	}
	plain(text.slice(at))
	return out
}

const ITEM = /^\s*([-*+]|\d+\.)\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const FENCE = /^```(\w*)\s*$/

/** The blocks of `content`: fenced code first, then quotes, list items and paragraphs by line. */
export const parseMarkdown = (content: string, names: Names): ReadonlyArray<Block> => {
	const blocks: Array<Block> = []
	const lines = content.replace(/\r\n?/g, "\n").split("\n")
	let paragraph: Array<string> = []
	let quote: Array<string> = []
	const flushParagraph = () => {
		if (paragraph.length > 0) blocks.push([BlockKind.paragraph, runsOf(paragraph.join("\n"), names)])
		paragraph = []
	}
	const flushQuote = () => {
		if (quote.length > 0) blocks.push([BlockKind.quote, runsOf(quote.join("\n"), names)])
		quote = []
	}
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? ""
		const fence = FENCE.exec(line.trim())
		if (fence !== null) {
			flushParagraph()
			flushQuote()
			const code: Array<string> = []
			index++
			while (index < lines.length && !/^```\s*$/.test((lines[index] ?? "").trim())) {
				code.push(lines[index] ?? "")
				index++
			}
			blocks.push([BlockKind.code, code.join("\n"), fence[1] ?? ""])
			continue
		}
		const quoted = QUOTE.exec(line)
		if (quoted !== null) {
			flushParagraph()
			quote.push(quoted[1] ?? "")
			continue
		}
		flushQuote()
		const item = ITEM.exec(line)
		if (item !== null) {
			flushParagraph()
			const marker = item[1] ?? "-"
			blocks.push([BlockKind.item, runsOf(item[2] ?? "", names), /^\d/.test(marker) ? marker : "•"])
			continue
		}
		if (line.trim() === "") flushParagraph()
		else paragraph.push(line)
	}
	flushParagraph()
	flushQuote()
	return blocks
}

const MARKS = /[*_`~#>|]/g

/** A one-line preview (the reply line, the thread card): mentions named, marks dropped. */
export const plainLine = (content: string, names: Names) =>
	content
		.replace(/@\[userId:([^\]]+)\]/g, (_, id: string) => `@${names.user(id) ?? "unknown"}`)
		.replace(/@\[group:([^\]]+)\]/g, (_, id: string) => `@${names.group(id) ?? "group"}`)
		.replace(/@\[directive:([^\]]+)\]/g, "@$1")
		.replace(/!\[custom-emoji:([^\]]+)\]\([^)]*\)/g, ":$1:")
		.replace(MARKS, "")
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0) ?? ""
