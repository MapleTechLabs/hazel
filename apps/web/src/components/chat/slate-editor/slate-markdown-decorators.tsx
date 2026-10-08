import type { RenderLeafProps } from "slate-react"
import { Focusable } from "react-aria-components"
import { EmojiPreview } from "~/components/emoji-preview"
import { Tooltip, TooltipContent } from "~/components/ui/tooltip"
import { markdownLeafClassName, type MarkdownRange } from "./slate-markdown-decorations"

export {
	decorateMarkdown,
	LINK_PATTERN,
	markdownLeafClassName,
	URL_PATTERN,
	type MarkdownDecorationType,
	type MarkdownRange,
} from "./slate-markdown-decorations"

export interface MarkdownLeafProps extends RenderLeafProps {
	/** Render mode: "composer" shows markdown syntax, "viewer" hides markers */
	mode?: "composer" | "viewer"
}

/**
 * Render leaf with markdown styling and code syntax highlighting
 * Markers are dimmed, content is styled, code tokens get Prism classes
 */
export function MarkdownLeaf({ attributes, children, leaf, mode = "composer" }: MarkdownLeafProps) {
	// Check for emoji decoration — runs before markdown so emoji inside bold/italic still gets tooltip
	const leafRecord = leaf as unknown as Record<string, unknown>
	if (leafRecord.type === "emoji" && leafRecord.shortcode) {
		const emoji = leafRecord.emoji as string
		const shortcode = leafRecord.shortcode as string
		return (
			<Tooltip delay={300} closeDelay={0}>
				<Focusable>
					<span {...attributes} role="button">
						{children}
					</span>
				</Focusable>
				<TooltipContent>
					<EmojiPreview emoji={emoji} shortcode={shortcode} size="sm" />
				</TooltipContent>
			</Tooltip>
		)
	}

	if (!leafRecord.token) {
		// Check if this leaf has markdown decoration
		const markdownLeaf = leaf as unknown as Partial<MarkdownRange>
		const markdownType = markdownLeaf.type
		const url = markdownLeaf.url
		const linkText = markdownLeaf.linkText

		// Handle markdown links [text](url) - render as actual <a> tag
		if (markdownType === "link" && url && linkText) {
			return (
				<a
					{...attributes}
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					className="cursor-pointer text-primary underline hover:text-primary-hover"
				>
					{linkText}
				</a>
			)
		}

		// Handle plain URLs - render as actual <a> tag
		if (markdownType === "url" && url) {
			return (
				<a
					{...attributes}
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					className="cursor-pointer text-primary underline hover:text-primary-hover"
				>
					{children}
				</a>
			)
		}
	}

	// Prism token classes, or the markdown style for this leaf
	const className = markdownLeafClassName(leafRecord, mode)

	return (
		<span {...attributes} className={className}>
			{children}
		</span>
	)
}
