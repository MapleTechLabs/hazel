import type { Html, HtmlBuilder } from "foldkit/html"
import { formatDistanceToNow } from "../../page/notifications/inbox/format"
import { cn } from "~/lib/utils"
import { IconHashtag, IconPaperclip2 } from "../../icons"
import { avatar } from "../../ui/avatar"
import { Message } from "./message"
import type { SearchResult } from "./search-data"

/** `SearchResultItem` and `MarkdownText` (`components/command-palette/`). */

type TagType = "strong" | "em" | "s" | "u" | "mark" | "code"

// Markdown patterns ordered by priority (longer markers first to avoid conflicts)
const MARKDOWN_PATTERNS: Array<{ pattern: RegExp; tag: TagType; className: string }> = [
	{ pattern: /\*\*([^*]+)\*\*/g, tag: "strong", className: "font-bold" },
	{ pattern: /~~([^~]+)~~/g, tag: "s", className: "line-through" },
	{ pattern: /__([^_]+)__/g, tag: "u", className: "underline" },
	{ pattern: /==([^=]+)==/g, tag: "mark", className: "bg-highlight rounded px-0.5" },
	{ pattern: /`([^`]+)`/g, tag: "code", className: "bg-accent/50 rounded px-1 py-0.5 font-mono text-xs" },
	{ pattern: /\*([^*]+)\*/g, tag: "em", className: "italic" },
	{ pattern: /_([^_]+)_/g, tag: "em", className: "italic" },
]

interface Segment {
	text: string
	style: string
	tag: TagType | null
}

/**
 * Parse text into segments with markdown styling
 */
const parseMarkdown = (text: string): Segment[] => {
	// Track which ranges have formatting applied
	interface Range {
		start: number
		end: number
		style: string
		tag: TagType
		contentStart: number
		contentEnd: number
	}

	const ranges: Range[] = []

	// Find all markdown matches
	for (const { pattern, tag, className } of MARKDOWN_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags)
		let match: RegExpExecArray | null
		while ((match = regex.exec(text)) !== null) {
			const fullMatch = match[0]
			const content = match[1]
			if (!content) continue

			const start = match.index
			const end = start + fullMatch.length

			// Calculate content boundaries (excluding markers)
			const markerLength = (fullMatch.length - content.length) / 2
			const contentStart = start + markerLength
			const contentEnd = contentStart + content.length

			// Check for overlaps with existing ranges
			const overlaps = ranges.some(
				(r) =>
					(start >= r.start && start < r.end) ||
					(end > r.start && end <= r.end) ||
					(start <= r.start && end >= r.end),
			)

			if (!overlaps) {
				ranges.push({
					start,
					end,
					style: className,
					tag,
					contentStart,
					contentEnd,
				})
			}
		}
	}

	// Sort ranges by start position
	ranges.sort((a, b) => a.start - b.start)

	// Build segments
	const segments: Segment[] = []
	let currentPos = 0

	for (const range of ranges) {
		// Add plain text before this range
		if (range.start > currentPos) {
			segments.push({
				text: text.slice(currentPos, range.start),
				style: "",
				tag: null,
			})
		}

		// Add the styled content (without markers)
		segments.push({
			text: text.slice(range.contentStart, range.contentEnd),
			style: range.style,
			tag: range.tag,
		})

		currentPos = range.end
	}

	// Add remaining text
	if (currentPos < text.length) {
		segments.push({
			text: text.slice(currentPos),
			style: "",
			tag: null,
		})
	}

	// If no segments, return the original text as a single segment
	if (segments.length === 0) {
		return [{ text, style: "", tag: null }]
	}

	return segments
}


/** `highlightSearchQuery`: every case-insensitive match in a `<mark>`. */
const highlight = (h: HtmlBuilder<Message>, text: string, query: string): Array<Html | string> => {
	if (!query.trim()) return [text]
	const parts: Array<Html | string> = []
	const lowered = text.toLowerCase()
	const needle = query.toLowerCase()
	let last = 0
	let index = lowered.indexOf(needle)
	while (index !== -1) {
		if (index > last) parts.push(text.slice(last, index))
		parts.push(h.mark([h.Class("bg-warning/30 text-inherit")], [text.slice(index, index + query.length)]))
		last = index + query.length
		index = lowered.indexOf(needle, last)
	}
	if (last < text.length) parts.push(text.slice(last))
	return parts.length > 0 ? parts : [text]
}

const TAGS: Readonly<Record<TagType, "strong" | "em" | "s" | "u" | "mark" | "code">> = {
	strong: "strong",
	em: "em",
	s: "s",
	u: "u",
	mark: "mark",
	code: "code",
}

const markdownText = (h: HtmlBuilder<Message>, text: string, query: string, className: string): Html =>
	h.p(
		[h.Class(className)],
		parseMarkdown(text).map((segment) =>
			segment.tag === null
				? h.span([], highlight(h, segment.text, query))
				: h[TAGS[segment.tag]]([h.Class(segment.style)], highlight(h, segment.text, query)),
		),
	)

const truncate = (content: string, maxLength = 120) =>
	content.length <= maxLength ? content : `${content.slice(0, maxLength).trim()}...`

export const searchResultItem = (
	h: HtmlBuilder<Message>,
	result: SearchResult,
	query: string,
	isSelected: boolean,
	index: number,
	nowMs: number,
): Html =>
	h.keyed("button")(
		result.messageId,
		[
			h.Type("button"),
			h.Class(
				cn(
					"group flex w-full cursor-pointer gap-3 rounded-md px-2.5 py-2 text-left transition-colors",
					"hover:bg-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
					isSelected && "bg-secondary",
				),
			),
			h.OnClick(Message.ClickedSearchResult({ index })),
		],
		[
			avatar(h, {
				size: "sm",
				src: result.authorAvatarUrl,
				alt: result.authorName,
				seed: result.authorName,
				className: "mt-0.5 shrink-0",
			}),
			h.div(
				[h.Class("min-w-0 flex-1")],
				[
					h.div(
						[h.Class("flex items-center gap-2 text-sm")],
						[
							h.span([h.Class("truncate font-medium text-fg")], [result.authorName]),
							...(result.channelName === null
								? []
								: [
										h.span([h.Class("text-muted-fg")], ["in"]),
										h.span(
											[h.Class("inline-flex items-center gap-0.5 truncate text-muted-fg")],
											[IconHashtag(h, { className: "size-3" }), result.channelName],
										),
									]),
							h.span(
								[h.Class("ml-auto shrink-0 text-muted-fg text-xs")],
								[formatDistanceToNow(Math.min(result.createdAtMs, nowMs), nowMs)],
							),
						],
					),
					markdownText(h, truncate(result.content), query, "mt-0.5 line-clamp-2 text-muted-fg text-sm"),
					...(result.attachmentCount > 0
						? [
								h.div(
									[h.Class("mt-1 flex items-center gap-1 text-muted-fg text-xs")],
									[
										IconPaperclip2(h, { className: "size-3" }),
										h.span([], [
											`${result.attachmentCount} ${result.attachmentCount === 1 ? "attachment" : "attachments"}`,
										]),
									],
								),
							]
						: []),
				],
			),
		],
	)
