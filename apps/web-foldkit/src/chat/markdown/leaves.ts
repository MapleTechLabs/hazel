import type { Html, HtmlBuilder } from "foldkit/html"
import { codeLeafClassName, codeLeaves } from "../../editor/code-highlight"
import { LINK_CLASS, type LeafProps, viewerLeafClassName, viewerLeaves } from "../../editor/decorations"

/** The read-only viewer's text and leaf DOM (Slate's `String`, `Leaf`, `MarkdownLeaf` markup). */

/** A decorated run of text: markdown/emoji props, or a Prism token class inside a code block. */
export interface ViewerLeaf extends LeafProps {
	readonly text: string
	readonly tokenClass?: string
}

/** Markdown and emoji leaves of one text run (`editor/decorations.ts`). */
export const textLeaves = (text: string): ReadonlyArray<ViewerLeaf> =>
	viewerLeaves(text).map(({ start, end, ...props }) => ({ ...props, text: text.slice(start, end) }))

/** Prism leaves of a code block's text (`editor/code-highlight.ts`). */
export const codeBlockLeaves = (code: string, language: string | null): ReadonlyArray<ViewerLeaf> =>
	codeLeaves(code, language).map((leaf) => ({ text: leaf.text, tokenClass: codeLeafClassName(leaf) }))

export interface LeafContext {
	readonly isLast: boolean
	readonly isLastText: boolean
	readonly isBlockEmpty: boolean
}

/** slate-react `String`: zero-width placeholders for empty leaves, a trailing newline kept visible. */
const leafString = <M>(h: HtmlBuilder<M>, leaf: ViewerLeaf, context: LeafContext): Html => {
	if (leaf.text === "")
		return context.isLastText && context.isBlockEmpty
			? h.span(
					[h.Attribute("data-slate-zero-width", "n"), h.Attribute("data-slate-length", "0")],
					["﻿", h.br([])],
				)
			: h.span([h.Attribute("data-slate-zero-width", "z"), h.Attribute("data-slate-length", "0")], ["﻿"])
	const text = context.isLast && leaf.text.endsWith("\n") ? `${leaf.text}\n` : leaf.text
	return h.span([h.Attribute("data-slate-string", "true")], [text])
}

const externalLink = <M>(h: HtmlBuilder<M>, url: string, content: Html | string): Html =>
	h.a(
		[
			h.Attribute("data-slate-leaf", "true"),
			h.Href(url),
			h.Attribute("target", "_blank"),
			h.Attribute("rel", "noopener noreferrer"),
			h.Class(LINK_CLASS),
		],
		[content],
	)

/** `MarkdownLeaf` in viewer mode. */
const leafView = <M>(h: HtmlBuilder<M>, leaf: ViewerLeaf, content: Html): Html => {
	const leafAttribute = h.Attribute("data-slate-leaf", "true")
	if (leaf.tokenClass !== undefined)
		return h.span([leafAttribute, h.Attribute("class", leaf.tokenClass)], [content])
	if (leaf.type === "emoji" && leaf.shortcode)
		return h.span([leafAttribute, h.Attribute("role", "button"), h.Attribute("tabindex", "0")], [content])
	if (leaf.type === "link" && leaf.url !== undefined && leaf.linkText !== undefined)
		return externalLink(h, leaf.url, leaf.linkText)
	if (leaf.type === "url" && leaf.url !== undefined) return externalLink(h, leaf.url, content)
	return h.span([leafAttribute, h.Attribute("class", viewerLeafClassName(leaf))], [content])
}

/** A Slate text node: one `data-slate-node="text"` span holding its decorated leaves. */
export const textNodeView = <M>(
	h: HtmlBuilder<M>,
	leaves: ReadonlyArray<ViewerLeaf>,
	context: Omit<LeafContext, "isLast">,
): Html =>
	h.span(
		[h.Attribute("data-slate-node", "text")],
		leaves.map((leaf, index) =>
			leafView(
				h,
				leaf,
				leafString(h, leaf, {
					...context,
					isLast: context.isLastText && index === leaves.length - 1,
				}),
			),
		),
	)

/** The `[{ text: "" }]` child every void inline element renders. */
export const voidChildView = <M>(h: HtmlBuilder<M>): Html =>
	textNodeView(h, [{ text: "" }], { isLastText: true, isBlockEmpty: true })
