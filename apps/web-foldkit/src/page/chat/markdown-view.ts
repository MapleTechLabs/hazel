import type { Html, HtmlBuilder } from "foldkit/html"
import {
	type CustomDescendant,
	type CustomElement,
	deserializeFromMarkdown,
	isEmojiOnly,
	markdownLeafClassName,
	viewerLeaves,
	type ViewerLeaf,
} from "~/components/chat/slate-editor/slate-message-viewer-model"
import { cx } from "~/utils/cx"

/**
 * Port of `SlateMessageViewer` as a pure view: the same parse (`deserializeFromMarkdown`), the same
 * decorations and leaf classes, and the DOM a read-only Slate `Editable` produces, with no editor
 * instance per message (plan §3.4).
 */

type TextNode = { readonly text: string }

const isText = (node: CustomDescendant): node is CustomDescendant & TextNode => "text" in node

const nodeString = (node: CustomDescendant): string =>
	isText(node)
		? node.text
		: "children" in node
			? (node.children as CustomDescendant[]).map(nodeString).join("")
			: ""

/** slate-react `String`: zero-width placeholders for empty leaves, a trailing newline kept visible. */
const leafString = <Message>(
	h: HtmlBuilder<Message>,
	leaf: ViewerLeaf,
	context: { readonly isLast: boolean; readonly isLastText: boolean; readonly isBlockEmpty: boolean },
): Html => {
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
const leafView = <Message>(h: HtmlBuilder<Message>, leaf: ViewerLeaf, content: Html): Html => {
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

const textView = <Message>(
	h: HtmlBuilder<Message>,
	text: TextNode,
	path: ReadonlyArray<number>,
	parent: CustomElement,
	context: { readonly isLastText: boolean; readonly isBlockEmpty: boolean },
): Html => {
	const leaves = viewerLeaves(text, [...path], parent)
	return h.span(
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
}

const headingClass = (level: number) =>
	level === 1
		? cx("font-semibold tracking-tight", "mt-4 mb-2 text-2xl first:mt-0")
		: level === 2
			? cx("font-semibold tracking-tight", "mt-3 mb-1.5 text-xl first:mt-0")
			: cx("font-semibold tracking-tight", "mt-2 mb-1 text-lg first:mt-0")

const elementView = <Message>(
	h: HtmlBuilder<Message>,
	element: CustomElement,
	path: ReadonlyArray<number>,
): Html => {
	const children = (element.children as CustomDescendant[]).map((child, index) =>
		isText(child)
			? textView(h, child, [...path, index], element, {
					isLastText: index === element.children.length - 1,
					isBlockEmpty: nodeString(element) === "",
				})
			: elementView(h, child as CustomElement, [...path, index]),
	)
	const node = h.Attribute("data-slate-node", "element")
	if (element.type === "paragraph") return h.p([node, h.Class("my-0 last:empty:hidden")], children)
	if (element.type === "list-item") return h.li([node, h.Class("my-0.5 ml-4")], children)
	if (element.type === "subtext") return h.p([node, h.Class("my-0 text-muted-fg text-xs")], children)
	if (element.type === "blockquote")
		return h.blockquote(
			[node, h.Class("relative my-1 pl-4 italic")],
			[
				h.span(
					[
						h.Class("absolute top-0 left-0 h-full w-1 rounded-xs bg-primary"),
						h.Attribute("aria-hidden", "true"),
					],
					[],
				),
				...children,
			],
		)
	if (element.type === "heading") {
		const tag = element.level === 1 ? h.h1 : element.level === 2 ? h.h2 : h.h3
		return tag([node, h.Class(headingClass(element.level))], children)
	}
	// Code blocks, mentions, custom emoji and tables keep their legacy markup in Phase 3.
	return h.p([node], children)
}

export const markdownView = <Message>(h: HtmlBuilder<Message>, content: string): Html => {
	const value = deserializeFromMarkdown(content)
	return h.div(
		[h.Class(cx("w-full", undefined))],
		[
			h.div(
				[
					h.Class(
						cx(
							"wrap-break-word w-full cursor-text select-text whitespace-pre-wrap",
							isEmojiOnly(content) ? "text-2xl" : "text-base",
							"[&_strong]:font-bold",
						),
					),
					h.Attribute("contenteditable", "false"),
					h.Attribute("data-slate-editor", "true"),
					h.Attribute("data-slate-node", "value"),
					h.Attribute(
						"style",
						"position: relative; white-space: pre-wrap; overflow-wrap: break-word;",
					),
					h.Attribute("translate", "no"),
					h.Attribute("zindex", "-1"),
				],
				value.map((node, index) =>
					isText(node) ? h.span([], [node.text]) : elementView(h, node as CustomElement, [index]),
				),
			),
		],
	)
}
