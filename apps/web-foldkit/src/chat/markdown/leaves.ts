import type { Html, HtmlBuilder } from "foldkit/html"
import {
	type CustomDescendant,
	type CustomElement,
	markdownLeafClassName,
	type ViewerLeaf,
} from "~/components/chat/slate-editor/slate-message-viewer-model"

/** Slate's text and leaf DOM for the read-only viewer (`String`, `Leaf`, `MarkdownLeaf`). */

export type TextNode = { readonly text: string }

export const isText = (node: CustomDescendant): node is CustomDescendant & TextNode => "text" in node

export const childrenOf = (element: CustomElement): ReadonlyArray<CustomDescendant> =>
	"children" in element ? (element.children as CustomDescendant[]) : []

export const nodeString = (node: CustomDescendant): string =>
	isText(node)
		? node.text
		: childrenOf(node as CustomElement)
				.map(nodeString)
				.join("")

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

const LINK_CLASS = "cursor-pointer text-primary underline hover:text-primary-hover"

/** `MarkdownLeaf` in viewer mode. */
const leafView = <M>(h: HtmlBuilder<M>, leaf: ViewerLeaf, content: Html): Html => {
	const leafAttribute = h.Attribute("data-slate-leaf", "true")
	if (leaf.type === "emoji" && leaf.shortcode)
		return h.span([leafAttribute, h.Attribute("role", "button"), h.Attribute("tabindex", "0")], [content])
	if (
		!leaf.token &&
		leaf.type === "link" &&
		typeof leaf.url === "string" &&
		typeof leaf.linkText === "string"
	)
		return h.a(
			[
				leafAttribute,
				h.Href(leaf.url),
				h.Attribute("target", "_blank"),
				h.Attribute("rel", "noopener noreferrer"),
				h.Class(LINK_CLASS),
			],
			[leaf.linkText],
		)
	if (!leaf.token && leaf.type === "url" && typeof leaf.url === "string")
		return h.a(
			[
				leafAttribute,
				h.Href(leaf.url),
				h.Attribute("target", "_blank"),
				h.Attribute("rel", "noopener noreferrer"),
				h.Class(LINK_CLASS),
			],
			[content],
		)
	return h.span([leafAttribute, h.Attribute("class", markdownLeafClassName(leaf, "viewer"))], [content])
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
