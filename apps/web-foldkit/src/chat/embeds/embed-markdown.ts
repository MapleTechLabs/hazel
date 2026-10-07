import type { Html, HtmlBuilder } from "foldkit/html"
import type { VariantProps } from "tailwind-variants"
import { colorMap } from "~/components/embeds/embed-markdown.styles"
import type { badgeStyles } from "~/components/ui/badge.styles"
import { cn } from "~/lib/utils"
import { badge } from "../../ui/badge"

/** Port of `components/embeds/embed-markdown.tsx`: same parser, same DOM per segment. */

type SegmentType =
	| "text"
	| "bold"
	| "italic"
	| "strikethrough"
	| "code"
	| "link"
	| "url"
	| "colored"
	| "badge"

interface ParsedSegment {
	type: SegmentType
	content: string
	url?: string
	color?: string
	children?: ParsedSegment[]
}

const patterns: ReadonlyArray<{ readonly regex: RegExp; readonly type: SegmentType }> = [
	{
		regex: /^\[\[(?:(primary|secondary|success|info|warning|danger|outline):)?([^\]]+)\]\]/,
		type: "badge",
	},
	{ regex: /^\{(\w+):([^}]+)\}/, type: "colored" },
	{ regex: /^\*\*(.+?)\*\*/, type: "bold" },
	{ regex: /^__(.+?)__/, type: "bold" },
	{ regex: /^\*([^*]+?)\*/, type: "italic" },
	{ regex: /^_([^_]+?)_/, type: "italic" },
	{ regex: /^~~(.+?)~~/, type: "strikethrough" },
	{ regex: /^`([^`]+)`/, type: "code" },
	{ regex: /^\[([^\]]+)\]\(([^)]+)\)/, type: "link" },
	{ regex: /^(https?:\/\/[^\s<>"\]]+)/, type: "url" },
]

/** Matches the first pattern at the head of `remaining`, mirroring the legacy loop exactly. */
const matchHead = (remaining: string): { segment: ParsedSegment; length: number } | null => {
	for (const pattern of patterns) {
		const match = remaining.match(pattern.regex)
		if (!match) continue
		if (pattern.type === "badge" && match[2] !== undefined)
			return { segment: { type: "badge", color: match[1], content: match[2] }, length: match[0].length }
		if (match[1] === undefined) continue
		const captured = match[1]
		const segment: ParsedSegment =
			pattern.type === "colored" && match[2] !== undefined
				? { type: "colored", color: captured, content: match[2] }
				: pattern.type === "link" && match[2] !== undefined
					? { type: "link", content: captured, url: match[2] }
					: pattern.type === "url"
						? { type: "url", content: captured, url: captured }
						: pattern.type === "code"
							? { type: "code", content: captured }
							: {
									type: pattern.type,
									content: captured,
									children: parseInlineMarkdown(captured),
								}
		return { segment, length: match[0].length }
	}
	return null
}

const parseInlineMarkdown = (text: string): ParsedSegment[] => {
	const segments: ParsedSegment[] = []
	let remaining = text
	while (remaining.length > 0) {
		const head = matchHead(remaining)
		if (head) {
			segments.push(head.segment)
			remaining = remaining.slice(head.length)
			continue
		}
		const char = remaining[0]
		if (char !== undefined) {
			const last = segments[segments.length - 1]
			if (last?.type === "text") last.content += char
			else segments.push({ type: "text", content: char })
		}
		remaining = remaining.slice(1)
	}
	return segments
}

type BadgeIntent = VariantProps<typeof badgeStyles>["intent"]

const renderSegments = <M>(h: HtmlBuilder<M>, segments: ReadonlyArray<ParsedSegment>): Html[] =>
	segments.map((segment) => {
		const inner = () => (segment.children ? renderSegments(h, segment.children) : [segment.content])
		switch (segment.type) {
			case "bold":
				return h.strong([h.Class("font-semibold")], inner())
			case "italic":
				return h.em([h.Class("italic")], inner())
			case "strikethrough":
				return h.s([h.Class("line-through")], inner())
			case "code":
				return h.code(
					[h.Class("rounded bg-muted/50 px-1 font-mono text-[0.85em]")],
					[segment.content],
				)
			case "colored":
				return h.span([h.Class(colorMap[segment.color ?? ""] ?? "text-fg")], [segment.content])
			case "badge":
				return badge(
					h,
					{ intent: (segment.color as BadgeIntent) ?? "secondary", size: "sm", isPill: true },
					[segment.content],
				)
			case "link":
			case "url":
				return h.a(
					[
						h.Href(segment.url ?? ""),
						h.Attribute("target", "_blank"),
						h.Attribute("rel", "noopener noreferrer"),
						h.Class("text-accent-fg hover:underline"),
					],
					[segment.content],
				)
			default:
				return h.span([], [segment.content])
		}
	})

/** `EmbedMarkdown`: React writes `class=""` for the empty `cn()`, so the attribute is kept. */
export const embedMarkdownView = <M>(h: HtmlBuilder<M>, text: string, className?: string): Html =>
	text
		? h.span([h.Attribute("class", cn(className))], renderSegments(h, parseInlineMarkdown(text)))
		: h.empty
