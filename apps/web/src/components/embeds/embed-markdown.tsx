"use client"

import type { ReactNode } from "react"
import { Badge, type BadgeProps } from "~/components/ui/badge"
import { cn } from "~/lib/utils"
import { type ParsedSegment, parseInlineMarkdown } from "./embed-markdown.parser"
import { colorMap } from "./embed-markdown.styles"

export interface EmbedMarkdownProps {
	/** The markdown text to render */
	children: string
	/** Additional class names */
	className?: string
}

/**
 * Renders parsed segments to React nodes
 */
function renderSegments(segments: ParsedSegment[]): ReactNode[] {
	return segments.map((segment, index) => {
		const key = `${segment.type}-${index}`

		switch (segment.type) {
			case "bold":
				return (
					<strong key={key} className="font-semibold">
						{segment.children ? renderSegments(segment.children) : segment.content}
					</strong>
				)
			case "italic":
				return (
					<em key={key} className="italic">
						{segment.children ? renderSegments(segment.children) : segment.content}
					</em>
				)
			case "strikethrough":
				return (
					<s key={key} className="line-through">
						{segment.children ? renderSegments(segment.children) : segment.content}
					</s>
				)
			case "code":
				return (
					<code key={key} className="rounded bg-muted/50 px-1 font-mono text-[0.85em]">
						{segment.content}
					</code>
				)
			case "colored": {
				const colorClass = colorMap[segment.color ?? ""] ?? "text-fg"
				return (
					<span key={key} className={colorClass}>
						{segment.content}
					</span>
				)
			}
			case "badge": {
				const intent = (segment.color as BadgeProps["intent"]) ?? "secondary"
				return (
					<Badge key={key} intent={intent} size="sm" isPill>
						{segment.content}
					</Badge>
				)
			}
			case "link":
			case "url":
				return (
					<a
						key={key}
						href={segment.url}
						target="_blank"
						rel="noopener noreferrer"
						className="text-accent-fg hover:underline"
						onClick={(e) => e.stopPropagation()}
					>
						{segment.content}
					</a>
				)
			default:
				return <span key={key}>{segment.content}</span>
		}
	})
}

/**
 * Renders inline markdown text with support for:
 * - Badges: [[text]], [[success:text]], [[danger:text]], etc.
 * - Colored text: {red:text}, {green:text}, {success:text}, etc.
 * - Bold: **text** or __text__
 * - Italic: *text* or _text_
 * - Strikethrough: ~~text~~
 * - Inline code: `text`
 * - Links: [text](url)
 * - Auto-linked URLs
 */
export function EmbedMarkdown({ children, className }: EmbedMarkdownProps) {
	if (!children) return null

	const segments = parseInlineMarkdown(children)

	return <span className={cn(className)}>{renderSegments(segments)}</span>
}
