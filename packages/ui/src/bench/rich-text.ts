/**
 * Message content as compact rich text: the shape a row's body takes on the wire in option C, and
 * what option A/B expand into `hz:paragraph` / `hz:run` nodes. Arrays, not objects, to keep bytes down.
 */
import type { Person } from "./fixture.ts"

/** A run: plain text, or `[kind, text, arg?]`. */
export type Run =
	| string
	| readonly [kind: typeof RunKind.mention, text: string, userId: string]
	| readonly [kind: typeof RunKind.link, text: string, url: string]
	| readonly [kind: typeof RunKind.code, text: string]
	| readonly [kind: typeof RunKind.strong, text: string]

export const RunKind = { mention: 1, link: 2, code: 3, strong: 4 } as const

export type Block =
	| readonly [kind: typeof BlockKind.paragraph, runs: ReadonlyArray<Run>]
	| readonly [kind: typeof BlockKind.code, text: string, language: string]
	| readonly [kind: typeof BlockKind.item, runs: ReadonlyArray<Run>, marker: string]

export const BlockKind = { paragraph: 0, code: 1, item: 2 } as const

const INLINE = /@\[userId:([^\]]+)\]|(https?:\/\/[^\s)]+)|`([^`]+)`|\*\*([^*]+)\*\*/g

export const runs = (text: string, names: ReadonlyMap<string, Person>): ReadonlyArray<Run> => {
	const out: Array<Run> = []
	let at = 0
	for (const match of text.matchAll(INLINE)) {
		const index = match.index
		if (index > at) out.push(text.slice(at, index))
		const [, mention, url, code, strong] = match
		if (mention !== undefined)
			out.push([RunKind.mention, `@${names.get(mention)?.name ?? "unknown"}`, mention])
		else if (url !== undefined) out.push([RunKind.link, url, url])
		else if (code !== undefined) out.push([RunKind.code, code])
		else if (strong !== undefined) out.push([RunKind.strong, strong])
		at = index + match[0].length
	}
	if (at < text.length) out.push(text.slice(at))
	return out
}

/** Paragraphs, fenced code blocks and list items (`- x`, `1. x`). */
export const parse = (content: string, names: ReadonlyMap<string, Person>): ReadonlyArray<Block> => {
	const blocks: Array<Block> = []
	const parts = content.split(/```(\w*)\n([\s\S]*?)\n?```/)
	for (let i = 0; i < parts.length; i += 3) {
		for (const paragraph of (parts[i] ?? "").split(/\n{2,}/)) {
			const lines = paragraph.split("\n").filter((line) => line.trim() !== "")
			let plain: Array<string> = []
			const flush = () => {
				if (plain.length > 0) blocks.push([BlockKind.paragraph, runs(plain.join("\n"), names)])
				plain = []
			}
			for (const line of lines) {
				const item = /^(-|\d+\.)\s+(.*)$/.exec(line)
				if (item === null) plain.push(line)
				else {
					flush()
					blocks.push([
						BlockKind.item,
						runs(item[2] ?? "", names),
						item[1] === "-" ? "•" : (item[1] ?? ""),
					])
				}
			}
			flush()
		}
		if (i + 2 < parts.length) blocks.push([BlockKind.code, parts[i + 2] ?? "", parts[i + 1] ?? ""])
	}
	return blocks
}
