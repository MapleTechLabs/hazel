/**
 * Markdown-in-text highlighting (W12b), ported from `apps/web-foldkit/src/editor/decorations.ts`
 * (composer mode): the markers stay in the text, dimmed, and the content between them is styled.
 * Text in, leaves out; `plugins.ts` turns each leaf into an inline decoration.
 */

/** A letter, digit, mark or underscore in any script: an `_` touching one is inside a word. */
const WORD = /[\p{L}\p{N}\p{M}_]/u
const isWord = (character: string | undefined) => character !== undefined && WORD.test(character)

export type Style =
	| "bold"
	| "italic"
	| "strikethrough"
	| "code"
	| "underline"
	| "highlight"
	| "spoiler"
	| "link"
	| "url"

type Boundary = (text: string, start: number, end: number) => boolean

const PATTERNS: ReadonlyArray<{
	readonly pattern: RegExp
	readonly style: Style
	readonly isValid?: Boundary
}> = [
	{ pattern: /(\*\*)([^*]+)(\*\*)/g, style: "bold" },
	{
		pattern: /(\*)([^*\s](?:[^*]*[^*\s])?)(\*)/g,
		style: "italic",
		isValid: (text, start, end) => text[start - 1] !== "*" && text[end] !== "*",
	},
	{ pattern: /(~~)([^~]+)(~~)/g, style: "strikethrough" },
	{ pattern: /(`)([^`]+)(`)/g, style: "code" },
	{ pattern: /(__)([^_]+)(__)/g, style: "underline" },
	{
		pattern: /(_)([^_\s](?:[^_]*[^_\s])?)(_)/g,
		style: "italic",
		isValid: (text, start, end) => !isWord(text[start - 1]) && !isWord(text[end]),
	},
	{ pattern: /(==)([^=]+)(==)/g, style: "highlight" },
	{ pattern: /(\|\|)([^|]+)(\|\|)/g, style: "spoiler" },
]

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g
const URL_TEXT = /(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/g
const CODE = /`[^`]+`/g
/** Stands in for a code span's characters, so no other pattern sees a marker inside one. */
const CODE_MASK = ""

export interface Leaf {
	readonly start: number
	readonly end: number
	readonly style?: Style
	readonly marker?: boolean
}

interface Range {
	readonly start: number
	readonly end: number
	readonly style: Style
	readonly marker: boolean
}

/** `pattern`'s matches that pass `isValid`; a rejected one is retried from its next character. */
function* matchesOf(text: string, pattern: RegExp, isValid: Boundary | undefined) {
	const regex = new RegExp(pattern.source, "g")
	let match = regex.exec(text)
	while (match !== null) {
		if (isValid === undefined || isValid(text, match.index, match.index + match[0].length)) yield match
		else regex.lastIndex = match.index + 1
		match = regex.exec(text)
	}
}

/** The parts of `start` to `end` outside the code spans. */
const outsideCode = (start: number, end: number, spans: ReadonlyArray<{ start: number; end: number }>) => {
	const pieces: Array<{ start: number; end: number }> = []
	let cursor = start
	for (const span of spans) {
		if (span.end <= cursor || span.start >= end) continue
		if (span.start > cursor) pieces.push({ start: cursor, end: span.start })
		cursor = Math.max(cursor, span.end)
	}
	if (cursor < end) pieces.push({ start: cursor, end })
	return pieces
}

const rangesOf = (text: string): ReadonlyArray<Range> => {
	const ranges: Array<Range> = []
	for (const match of text.matchAll(LINK))
		ranges.push({ start: match.index, end: match.index + match[0].length, style: "link", marker: false })
	for (const match of text.matchAll(URL_TEXT)) {
		const index = match.index
		if (ranges.some((range) => range.style === "link" && index >= range.start && index < range.end))
			continue
		ranges.push({ start: index, end: index + match[0].length, style: "url", marker: false })
	}
	const spans = [...text.matchAll(CODE)].map((match) => ({
		start: match.index,
		end: match.index + match[0].length,
	}))
	const masked = text.replace(CODE, (span) => CODE_MASK.repeat(span.length))
	for (const { pattern, style, isValid } of PATTERNS) {
		for (const match of matchesOf(style === "code" ? text : masked, pattern, isValid)) {
			const [whole, open, content, close] = match
			if (!open || !content || !close) continue
			const start = match.index
			const end = start + whole.length
			if (ranges.some((range) => range.style === "link" && start < range.end && end > range.start))
				continue
			const contentStart = start + open.length
			const contentEnd = contentStart + content.length
			ranges.push({ start, end: contentStart, style, marker: true })
			for (const piece of outsideCode(contentStart, contentEnd, style === "code" ? [] : spans))
				ranges.push({ ...piece, style, marker: false })
			ranges.push({ start: contentEnd, end, style, marker: true })
		}
	}
	return ranges
}

interface Mutable {
	text: string
	props: { style?: Style; marker?: boolean }
}

/** Slate's `Text.decorations`: split the text at range edges and assign each range in order. */
const split = (text: string, ranges: ReadonlyArray<Range>): ReadonlyArray<Leaf> => {
	let leaves: Array<Mutable> = [{ text, props: {} }]
	for (const { start: from, end: to, ...props } of ranges) {
		const next: Array<Mutable> = []
		let leafEnd = 0
		for (const leaf of leaves) {
			const leafStart = leafEnd
			leafEnd += leaf.text.length
			if (from <= leafStart && leafEnd <= to) {
				Object.assign(leaf.props, props)
				next.push(leaf)
				continue
			}
			if (
				(from !== to && (from === leafEnd || to === leafStart)) ||
				from > leafEnd ||
				to < leafStart ||
				(to === leafStart && leafStart !== 0)
			) {
				next.push(leaf)
				continue
			}
			let middle: Mutable = leaf
			let before: Mutable | undefined
			let after: Mutable | undefined
			if (to < leafEnd) {
				const offset = to - leafStart
				after = { text: middle.text.slice(offset), props: { ...middle.props } }
				middle = { text: middle.text.slice(0, offset), props: { ...middle.props } }
			}
			if (from > leafStart) {
				const offset = from - leafStart
				before = { text: middle.text.slice(0, offset), props: { ...middle.props } }
				middle = { text: middle.text.slice(offset), props: { ...middle.props } }
			}
			Object.assign(middle.props, props)
			if (before !== undefined) next.push(before)
			next.push(middle)
			if (after !== undefined) next.push(after)
		}
		leaves = next
	}
	let offset = 0
	return leaves.map((leaf) => {
		const start = offset
		offset += leaf.text.length
		return { start, end: offset, ...leaf.props }
	})
}

/** The styled leaves of one text run; unstyled runs are left out. */
export const markdownLeaves = (text: string): ReadonlyArray<Leaf> =>
	text === "" ? [] : split(text, rangesOf(text)).filter((leaf) => leaf.style !== undefined)
