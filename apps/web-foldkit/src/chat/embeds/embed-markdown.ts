import type { Html, HtmlBuilder } from "foldkit/html"
import type { VariantProps } from "tailwind-variants"
import { type ParsedSegment, parseInlineMarkdown } from "~/components/embeds/embed-markdown.parser"
import { colorMap } from "~/components/embeds/embed-markdown.styles"
import type { badgeStyles } from "~/components/ui/badge.styles"
import { cn } from "~/lib/utils"
import { badge } from "../../ui/badge"

/** Port of `components/embeds/embed-markdown.tsx`: the shared parser, the same DOM per segment. */

type BadgeIntent = VariantProps<typeof badgeStyles>["intent"]

type Segment = ParsedSegment

/** One renderer per segment type (the legacy `renderSegments` switch). */
const segmentViews = <M>(
	h: HtmlBuilder<M>,
	inner: (segment: Segment) => Array<Html | string>,
): Record<Segment["type"], (segment: Segment) => Html> => {
	const link = (segment: Segment) =>
		h.a(
			[
				h.Href(segment.url ?? ""),
				h.Attribute("target", "_blank"),
				h.Attribute("rel", "noopener noreferrer"),
				h.Class("text-accent-fg hover:underline"),
			],
			[segment.content],
		)
	return {
		bold: (segment) => h.strong([h.Class("font-semibold")], inner(segment)),
		italic: (segment) => h.em([h.Class("italic")], inner(segment)),
		strikethrough: (segment) => h.s([h.Class("line-through")], inner(segment)),
		code: (segment) =>
			h.code([h.Class("rounded bg-muted/50 px-1 font-mono text-[0.85em]")], [segment.content]),
		colored: (segment) =>
			h.span([h.Class(colorMap[segment.color ?? ""] ?? "text-fg")], [segment.content]),
		badge: (segment) =>
			badge(h, { intent: (segment.color as BadgeIntent) ?? "secondary", size: "sm", isPill: true }, [
				segment.content,
			]),
		link,
		url: link,
		text: (segment) => h.span([], [segment.content]),
	}
}

const renderSegments = <M>(h: HtmlBuilder<M>, segments: ReadonlyArray<Segment>): Html[] => {
	const views = segmentViews(h, (segment) =>
		segment.children ? renderSegments(h, segment.children) : [segment.content],
	)
	return segments.map((segment) => views[segment.type](segment))
}

/** `EmbedMarkdown`: React writes `class=""` for the empty `cn()`, so the attribute is kept. */
export const embedMarkdownView = <M>(h: HtmlBuilder<M>, text: string, className?: string): Html =>
	text
		? h.span([h.Attribute("class", cn(className))], renderSegments(h, parseInlineMarkdown(text)))
		: h.empty
