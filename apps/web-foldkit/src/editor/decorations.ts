import { Match } from "effect"
import { getEmojiShortcode } from "~/lib/emoji-shortcode-map"

/**
 * Discord-style markdown highlighting for the composer and the message viewer, ported from the
 * legacy Slate decorators (`decorateMarkdown`, `decorateEmoji`, `MarkdownLeaf`) and Slate's
 * `Text.decorations` leaf splitting. Framework-free: text in, leaves out.
 *
 * The split and merge rules are Slate's. A single `*` or `_` next to another marker character
 * is not italic, so `**bold**` stays bold and `snake_case_names` stay plain, and nothing inside
 * an inline code span is decorated.
 */

const MARKDOWN_PATTERNS = [
	{ pattern: /(\*\*)([^*]+)(\*\*)/g, type: "bold" },
	{ pattern: /(?<!\*)(\*)(?!\s)([^*]+)(?<!\s)(\*)(?!\*)/g, type: "italic" },
	{ pattern: /(~~)([^~]+)(~~)/g, type: "strikethrough" },
	{ pattern: /(`)([^`]+)(`)/g, type: "code" },
	{ pattern: /(__)([^_]+)(__)/g, type: "underline" },
	{ pattern: /(?<!\w)(_)(?!\s)([^_]+)(?<!\s)(_)(?!\w)/g, type: "italic" },
	{ pattern: /(==)([^=]+)(==)/g, type: "highlight" },
	{ pattern: /(\|\|)([^|]+)(\|\|)/g, type: "spoiler" },
] as const

const CODE_PATTERN = /`[^`]+`/g

export const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g
export const URL_PATTERN = /(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/g

export type MarkdownDecorationType = (typeof MARKDOWN_PATTERNS)[number]["type"] | "link" | "url"

export interface LeafProps {
	type?: MarkdownDecorationType | "emoji"
	isMarker?: boolean
	url?: string
	linkText?: string
	/** A Unicode emoji with a known shortcode (viewer only). */
	emoji?: string
	shortcode?: string
}

interface MarkdownRange extends LeafProps {
	readonly start: number
	readonly end: number
}

/** `decorateMarkdown` for one text run (Slate decorates each text node separately). */
export function decorateMarkdown(text: string): ReadonlyArray<MarkdownRange> {
	const ranges: Array<MarkdownRange> = []
	if (!text) return ranges

	for (const match of text.matchAll(LINK_PATTERN)) {
		ranges.push({
			start: match.index,
			end: match.index + match[0].length,
			type: "link",
			isMarker: false,
			url: match[2],
			linkText: match[1],
		})
	}

	for (const match of text.matchAll(URL_PATTERN)) {
		const index = match.index
		const insideLink = ranges.some(
			(range) => range.type === "link" && index >= range.start && index < range.end,
		)
		if (insideLink) continue
		const url = match[0]
		ranges.push({
			start: index,
			end: index + url.length,
			type: "url",
			isMarker: false,
			url: url.startsWith("www.") ? `https://${url}` : url,
		})
	}

	const codeSpans = [...text.matchAll(CODE_PATTERN)].map((match) => ({
		start: match.index,
		end: match.index + match[0].length,
	}))
	for (const { pattern, type } of MARKDOWN_PATTERNS) {
		for (const match of text.matchAll(pattern)) {
			const [fullMatch, openMarker, content, closeMarker] = match
			if (!openMarker || !content || !closeMarker) continue
			const index = match.index
			const end = index + fullMatch.length
			const overlapsLink = ranges.some(
				(range) => range.type === "link" && index < range.end && end > range.start,
			)
			if (overlapsLink) continue
			const overlapsCode =
				type !== "code" && codeSpans.some((span) => index < span.end && end > span.start)
			if (overlapsCode) continue
			const contentStart = index + openMarker.length
			const contentEnd = contentStart + content.length
			ranges.push({ start: index, end: contentStart, type, isMarker: true })
			ranges.push({ start: contentStart, end: contentEnd, type, isMarker: false })
			ranges.push({ start: contentEnd, end: index + fullMatch.length, type, isMarker: true })
		}
	}

	return ranges
}

export interface Leaf extends LeafProps {
	readonly start: number
	readonly end: number
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** Codepoint ranges that make a grapheme an emoji; letters and digits never match. */
const EMOJI_CODEPOINT_RANGES: ReadonlyArray<readonly [number, number]> = [
	[0x1f300, 0x1faff], // Pictographs, emoticons, transport, symbols, chess, extended-A
	[0x1f1e6, 0x1f1ff], // Regional indicators (flags)
	[0x2600, 0x27bf], // Misc symbols, dingbats
	[0x231a, 0x231b],
	[0x2328, 0x2328],
	[0x23cf, 0x23cf],
	[0x23e9, 0x23f3],
	[0x23f8, 0x23fa],
	[0x200d, 0x200d], // ZWJ
	[0xfe00, 0xfe0f], // Variation selectors
	[0x2b05, 0x2b07],
	[0x2b1b, 0x2b1c],
	[0x2b50, 0x2b50],
	[0x2b55, 0x2b55],
	[0x2934, 0x2935],
	[0x25aa, 0x25ab],
	[0x25b6, 0x25b6],
	[0x25c0, 0x25c0],
	[0x25fb, 0x25fe],
	[0x2139, 0x2139],
	[0x2194, 0x2199],
	[0x21a9, 0x21aa],
	[0x00a9, 0x00a9],
	[0x00ae, 0x00ae],
	[0x2122, 0x2122],
	[0x24c2, 0x24c2],
	[0x3030, 0x3030],
	[0x303d, 0x303d],
	[0x3297, 0x3297],
	[0x3299, 0x3299],
]

const isEmojiGrapheme = (grapheme: string): boolean => {
	for (const char of grapheme) {
		const code = char.codePointAt(0) ?? 0
		if (EMOJI_CODEPOINT_RANGES.some(([low, high]) => code >= low && code <= high)) return true
	}
	return false
}

interface EmojiRange extends LeafProps {
	readonly start: number
	readonly end: number
}

/** `decorateEmoji`: Unicode emoji with a known shortcode, by grapheme (ZWJ sequences, flags, skin tones). */
export function decorateEmoji(text: string): ReadonlyArray<EmojiRange> {
	const ranges: Array<EmojiRange> = []
	for (const { segment, index } of segmenter.segment(text)) {
		if (!isEmojiGrapheme(segment)) continue
		const shortcode = getEmojiShortcode(segment)
		if (!shortcode) continue
		ranges.push({ start: index, end: index + segment.length, type: "emoji", emoji: segment, shortcode })
	}
	return ranges
}

/** Slate's `Text.decorations`: split the text at range edges and `Object.assign` each range in order. */
export function splitLeaves(
	text: string,
	ranges: ReadonlyArray<MarkdownRange | EmojiRange>,
): ReadonlyArray<Leaf> {
	type Mutable = { text: string; props: LeafProps }
	let leaves: Array<Mutable> = [{ text, props: {} }]
	for (const { start: decorationStart, end: decorationEnd, ...props } of ranges) {
		const next: Array<Mutable> = []
		let leafEnd = 0
		for (const leaf of leaves) {
			const leafStart = leafEnd
			leafEnd += leaf.text.length
			if (decorationStart <= leafStart && leafEnd <= decorationEnd) {
				Object.assign(leaf.props, props)
				next.push(leaf)
				continue
			}
			if (
				(decorationStart !== decorationEnd &&
					(decorationStart === leafEnd || decorationEnd === leafStart)) ||
				decorationStart > leafEnd ||
				decorationEnd < leafStart ||
				(decorationEnd === leafStart && leafStart !== 0)
			) {
				next.push(leaf)
				continue
			}
			let middle: Mutable = leaf
			let before: Mutable | undefined
			let after: Mutable | undefined
			if (decorationEnd < leafEnd) {
				const offset = decorationEnd - leafStart
				after = { text: middle.text.slice(offset), props: { ...middle.props } }
				middle = { text: middle.text.slice(0, offset), props: { ...middle.props } }
			}
			if (decorationStart > leafStart) {
				const offset = decorationStart - leafStart
				before = { text: middle.text.slice(0, offset), props: { ...middle.props } }
				middle = { text: middle.text.slice(offset), props: { ...middle.props } }
			}
			Object.assign(middle.props, props)
			if (before) next.push(before)
			next.push(middle)
			if (after) next.push(after)
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

export const LINK_CLASS = "cursor-pointer text-primary underline hover:text-primary-hover"

/** `MarkdownLeaf` in composer mode: the class for a decorated leaf. */
export function leafClassName(leaf: LeafProps): string {
	if (!leaf.type) return ""
	if (leaf.isMarker) return "text-muted-fg/50 select-none"
	return Match.value(leaf.type).pipe(
		Match.when("bold", () => "font-bold"),
		Match.when("italic", () => "italic"),
		Match.when("strikethrough", () => "line-through"),
		Match.when("code", () => "bg-accent/50 rounded px-1 py-0.5 font-mono text-sm"),
		Match.when("underline", () => "underline"),
		Match.when("highlight", () => "bg-highlight rounded px-0.5"),
		Match.when("spoiler", () => "bg-muted blur-sm hover:blur-none transition-all"),
		Match.whenOr("link", "url", () => LINK_CLASS),
		Match.when("emoji", () => ""),
		Match.exhaustive,
	)
}

/** `MarkdownLeaf` in viewer mode: markers are hidden instead of dimmed. */
export const viewerLeafClassName = (leaf: LeafProps): string =>
	leaf.type && leaf.isMarker ? "hidden" : leafClassName(leaf)

/** Leaves for one text run, ready to render. */
export const markdownLeaves = (text: string) => splitLeaves(text, decorateMarkdown(text))

/** The viewer's leaves for one text run: markdown, then emoji (the viewer's `decorate` order). */
export const viewerLeaves = (text: string) =>
	splitLeaves(text, [...decorateMarkdown(text), ...decorateEmoji(text)])
