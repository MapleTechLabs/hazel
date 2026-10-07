import { Match } from "effect"

/**
 * Discord-style markdown highlighting for the composer, ported from the legacy
 * `slate-markdown-decorators.tsx` (`decorateMarkdown` + `MarkdownLeaf` in composer mode)
 * and Slate's `Text.decorations` leaf splitting. Framework-free: text in, leaves out.
 *
 * The split and merge rules are Slate's, so leaf boundaries and classes match the legacy
 * DOM exactly, quirks included: `**bold**` also matches the italic pattern, which is
 * merged last, so its content renders `italic`.
 */

const MARKDOWN_PATTERNS = [
	{ pattern: /(\*\*)([^*]+)(\*\*)/g, type: "bold" },
	{ pattern: /(\*)([^*]+)(\*)/g, type: "italic" },
	{ pattern: /(~~)([^~]+)(~~)/g, type: "strikethrough" },
	{ pattern: /(`)([^`]+)(`)/g, type: "code" },
	{ pattern: /(__)([^_]+)(__)/g, type: "underline" },
	{ pattern: /(_)([^_]+)(_)/g, type: "italic" },
	{ pattern: /(==)([^=]+)(==)/g, type: "highlight" },
	{ pattern: /(\|\|)([^|]+)(\|\|)/g, type: "spoiler" },
] as const

export const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g
export const URL_PATTERN = /(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/g

export type MarkdownDecorationType = (typeof MARKDOWN_PATTERNS)[number]["type"] | "link" | "url"

interface LeafProps {
	type?: MarkdownDecorationType
	isMarker?: boolean
	url?: string
	linkText?: string
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
		const insideLink = ranges.some((range) => range.type === "link" && index >= range.start && index < range.end)
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

	for (const { pattern, type } of MARKDOWN_PATTERNS) {
		for (const match of text.matchAll(pattern)) {
			const [fullMatch, openMarker, content, closeMarker] = match
			if (!openMarker || !content || !closeMarker) continue
			const index = match.index
			const overlapsLink = ranges.some(
				(range) => range.type === "link" && index < range.end && index + fullMatch.length > range.start,
			)
			if (overlapsLink) continue
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

/** Slate's `Text.decorations`: split the text at range edges and `Object.assign` each range in order. */
export function splitLeaves(text: string, ranges: ReadonlyArray<MarkdownRange>): ReadonlyArray<Leaf> {
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
		Match.exhaustive,
	)
}

/** Leaves for one text run, ready to render. */
export const markdownLeaves = (text: string) => splitLeaves(text, decorateMarkdown(text))
