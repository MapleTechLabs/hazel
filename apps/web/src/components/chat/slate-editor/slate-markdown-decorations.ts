import type { BaseRange } from "slate"

/**
 * Markdown decorations for message text (patterns, ranges, leaf classes). Framework-free so the
 * React viewer and the Foldkit viewer decorate and style leaves identically.
 */

// Markdown patterns for Discord-style highlighting
const MARKDOWN_PATTERNS = [
	{
		pattern: /(\*\*)([^*]+)(\*\*)/g,
		type: "bold" as const,
	},
	{
		pattern: /(\*)([^*]+)(\*)/g,
		type: "italic" as const,
	},
	{
		pattern: /(~~)([^~]+)(~~)/g,
		type: "strikethrough" as const,
	},
	{
		pattern: /(`)([^`]+)(`)/g,
		type: "code" as const,
	},
	{
		pattern: /(__)([^_]+)(__)/g,
		type: "underline" as const,
	},
	{
		pattern: /(_)([^_]+)(_)/g,
		type: "italic" as const,
	},
	{
		pattern: /(==)([^=]+)(==)/g,
		type: "highlight" as const,
	},
	{
		pattern: /(\|\|)([^|]+)(\|\|)/g,
		type: "spoiler" as const,
	},
] as const

// Link pattern: [text](url)
export const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g

// Plain URL pattern: matches http(s):// or www. URLs
export const URL_PATTERN = /(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/g

export type MarkdownDecorationType = (typeof MARKDOWN_PATTERNS)[number]["type"] | "link" | "url"

export interface MarkdownRange extends BaseRange {
	[key: string]: unknown
	type: MarkdownDecorationType
	isMarker?: boolean
	url?: string
	linkText?: string
}

/**
 * Decorate text nodes with markdown syntax highlighting
 * This makes the markdown tokens visible but styled (Discord-style)
 * @param entry - The node and path tuple
 * @param parentElement - Optional parent element to check type
 */
export function decorateMarkdown(entry: [node: any, path: number[]], parentElement?: any): MarkdownRange[] {
	const [node, path] = entry
	const ranges: MarkdownRange[] = []

	if (!node.text) {
		return ranges
	}

	// Skip markdown decoration in code blocks
	if (parentElement?.type === "code-block") {
		return ranges
	}

	const text = node.text

	// Decorate markdown links (high priority)
	const linkMatches = text.matchAll(LINK_PATTERN)
	for (const match of linkMatches) {
		if (match.index === undefined) continue

		const fullMatch = match[0] // Full match: [text](url)
		const linkText = match[1] // Captured text between [ ]
		const url = match[2] // Captured URL between ( )

		// Mark entire link as a single range with metadata
		ranges.push({
			anchor: { path, offset: match.index },
			focus: { path, offset: match.index + fullMatch.length },
			type: "link",
			isMarker: false,
			url,
			linkText,
		})
	}

	// Decorate plain URLs (lower priority than markdown links)
	const urlMatches = text.matchAll(URL_PATTERN)
	for (const match of urlMatches) {
		if (match.index === undefined) continue

		const url = match[0]

		// Skip if this URL is part of a markdown link
		const overlapsMarkdownLink = ranges.some(
			(range) =>
				range.type === "link" &&
				match.index !== undefined &&
				match.index >= range.anchor.offset &&
				match.index < range.focus.offset,
		)
		if (overlapsMarkdownLink) continue

		// Normalize URL (add https:// if it starts with www.)
		const normalizedUrl = url.startsWith("www.") ? `https://${url}` : url

		ranges.push({
			anchor: { path, offset: match.index },
			focus: { path, offset: match.index + url.length },
			type: "url",
			isMarker: false,
			url: normalizedUrl,
		})
	}

	// Decorate other markdown patterns
	for (const { pattern, type } of MARKDOWN_PATTERNS) {
		const matches = text.matchAll(pattern)

		for (const match of matches) {
			if (match.index === undefined) continue

			const fullMatch = match[0]
			const openMarker = match[1]
			const content = match[2]
			const closeMarker = match[3]

			// Skip if the markers are escaped or incomplete
			if (!openMarker || !content || !closeMarker) continue

			// Skip if this overlaps with a link
			const specialOverlap = ranges.some(
				(range) =>
					range.type === "link" &&
					match.index !== undefined &&
					match.index < range.focus.offset &&
					match.index + fullMatch.length > range.anchor.offset,
			)
			if (specialOverlap) continue

			// Opening marker range
			ranges.push({
				anchor: { path, offset: match.index },
				focus: { path, offset: match.index + openMarker.length },
				type,
				isMarker: true,
			})

			// Content range
			ranges.push({
				anchor: { path, offset: match.index + openMarker.length },
				focus: { path, offset: match.index + openMarker.length + content.length },
				type,
				isMarker: false,
			})

			// Closing marker range
			ranges.push({
				anchor: { path, offset: match.index + openMarker.length + content.length },
				focus: { path, offset: match.index + fullMatch.length },
				type,
				isMarker: true,
			})
		}
	}

	return ranges
}

/**
 * Class name for a decorated leaf that is not an emoji, link or URL: Prism token classes for code,
 * otherwise the markdown style (markers are hidden in the viewer and dimmed in the composer).
 */
export function markdownLeafClassName(leaf: Record<string, unknown>, mode: "composer" | "viewer"): string {
	if (leaf.token) {
		// Build className from all token types (e.g., "token keyword", "token function")
		const tokenClasses: string[] = ["token"]
		for (const key in leaf) {
			if (key !== "text" && key !== "token" && leaf[key] === true) {
				tokenClasses.push(key)
			}
		}
		return tokenClasses.join(" ")
	}

	const markdownLeaf = leaf as Partial<MarkdownRange>
	const markdownType = markdownLeaf.type
	if (!markdownType) return ""
	if (markdownLeaf.isMarker) {
		return mode === "viewer" ? "hidden" : "text-muted-fg/50 select-none"
	}
	switch (markdownType) {
		case "bold":
			return "font-bold"
		case "italic":
			return "italic"
		case "strikethrough":
			return "line-through"
		case "code":
			return "bg-accent/50 rounded px-1 py-0.5 font-mono text-sm"
		case "underline":
			return "underline"
		case "highlight":
			return "bg-highlight rounded px-0.5"
		case "spoiler":
			return "bg-muted blur-sm hover:blur-none transition-all"
		default:
			return ""
	}
}
