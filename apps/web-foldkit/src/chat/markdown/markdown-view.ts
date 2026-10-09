import type { Html, HtmlBuilder } from "foldkit/html"
import {
	codeBlockLeaves,
	type CustomDescendant,
	type CustomElement,
	deserializeFromMarkdown,
	isEmojiOnly,
	viewerLeaves,
} from "~/components/chat/slate-editor/slate-message-viewer-model"
import { cn } from "~/lib/utils"
import { cx } from "~/utils/cx"
import { IconCopy } from "../../icons"
import { childrenOf, isText, nodeString, type TextNode, textNodeView, voidChildView } from "./leaves"

/**
 * Port of `SlateMessageViewer` as a pure view: the same parse (`deserializeFromMarkdown`), the same
 * decorations and leaf classes, and the DOM a read-only Slate `Editable` produces, with no editor
 * instance per message (plan §3.4).
 */

/** What the viewer resolves outside the markdown: mention names and custom emoji images. */
export interface MarkdownRefs {
	readonly mentions: ReadonlyArray<{ readonly userId: string; readonly name: string }>
	readonly emojis: ReadonlyArray<{ readonly name: string; readonly imageUrl: string }>
}

export const NO_REFS: MarkdownRefs = { mentions: [], emojis: [] }

type Path = ReadonlyArray<number>

const textView = <M>(h: HtmlBuilder<M>, text: TextNode, path: Path, parent: CustomElement, index: number) =>
	textNodeView(h, viewerLeaves(text, [...path], parent), {
		isLastText: index === childrenOf(parent).length - 1,
		isBlockEmpty: nodeString(parent) === "",
	})

const headingClass = (level: number) =>
	level === 1
		? cx("font-semibold tracking-tight", "mt-4 mb-2 text-2xl first:mt-0")
		: level === 2
			? cx("font-semibold tracking-tight", "mt-3 mb-1.5 text-xl first:mt-0")
			: cx("font-semibold tracking-tight", "mt-2 mb-1 text-lg first:mt-0")

const COLLAPSE_THRESHOLD = 15

/** `CodeBlockElement` with controls; collapsing past 15 lines starts collapsed. */
const codeBlockView = <M>(h: HtmlBuilder<M>, element: CustomElement, path: Path): Html => {
	const children = childrenOf(element)
	const codeText = children.map((child) => (isText(child) ? child.text : "")).join("")
	const language = ("language" in element && element.language) || "plaintext"
	const lineCount = codeText.split("\n").length
	const isCollapsible = lineCount > COLLAPSE_THRESHOLD
	const code = children.map((child, index) =>
		isText(child)
			? textNodeView(h, codeBlockLeaves(element, [...path], child, [...path, index]), {
					isLastText: index === children.length - 1,
					isBlockEmpty: codeText === "",
				})
			: h.span([]),
	)
	return h.div(
		[h.Class("group relative my-2"), h.Attribute("data-slate-node", "element")],
		[
			h.div(
				[h.Class("absolute top-2 right-2 z-10 flex items-center gap-2")],
				[
					...(language !== "plaintext"
						? [
								h.span(
									[
										h.Class(
											"rounded-md bg-info-subtle px-2 py-0.5 font-medium text-info-subtle-fg text-xs",
										),
									],
									[language],
								),
							]
						: []),
					h.span(
						[
							h.Attribute("role", "button"),
							h.Attribute("tabindex", "0"),
							h.Class(
								"cursor-pointer rounded bg-accent-9/10 p-1.5 opacity-0 transition-opacity hover:bg-accent-9/20 group-hover:opacity-100",
							),
							h.Attribute("contenteditable", "false"),
							h.Attribute("style", ""),
							h.Attribute("title", "Copy code"),
						],
						[IconCopy(h, { className: "size-3.5", attributes: { "data-slot": "icon" } })],
					),
				],
			),
			h.pre(
				[
					h.Class(
						cx(
							"overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-4 pr-24 font-mono text-sm",
							isCollapsible && "max-h-80 overflow-hidden",
						),
					),
				],
				[h.code([], code)],
			),
		],
	)
}

const MENTION_CLASS =
	"inline-block cursor-pointer rounded bg-primary/10 px-1 py-0.5 align-baseline font-medium text-primary transition-colors"

/** `MentionElement`, interactive (a popover trigger). */
const mentionView = <M>(h: HtmlBuilder<M>, element: CustomElement, refs: MarkdownRefs): Html => {
	const userId = "userId" in element ? String(element.userId) : ""
	const displayName = "displayName" in element ? String(element.displayName) : ""
	const node = h.Attribute("data-slate-node", "element")
	if (userId === "channel" || userId === "here")
		return h.span(
			[node, h.Attribute("contenteditable", "false"), h.Class(cn(MENTION_CLASS))],
			["@", displayName, voidChildView(h)],
		)
	const fullName = refs.mentions.find((mention) => mention.userId === userId)?.name ?? displayName
	return h.button(
		[
			h.Attribute("aria-expanded", "false"),
			h.Class(
				cn(
					"inline-block cursor-pointer rounded bg-primary/10 px-1 py-0.5 align-baseline font-medium text-primary outline-hidden transition-colors hover:bg-primary/20",
				),
			),
			h.Attribute("data-rac", ""),
			h.Attribute("data-react-aria-pressable", "true"),
			node,
			h.Attribute("tabindex", "0"),
			h.Attribute("type", "button"),
		],
		["@", fullName, voidChildView(h)],
	)
}

/** `CustomEmojiElement`: the org's image, or `:name:` when the org has no such emoji. */
const customEmojiView = <M>(h: HtmlBuilder<M>, element: CustomElement, refs: MarkdownRefs): Html => {
	const name = "name" in element ? String(element.name) : ""
	const node = h.Attribute("data-slate-node", "element")
	const imageUrl = refs.emojis.find((emoji) => emoji.name === name)?.imageUrl
	if (!imageUrl)
		return h.span(
			[node, h.Attribute("contenteditable", "false"), h.Class("inline-block align-text-bottom")],
			[`:${name}:`, voidChildView(h)],
		)
	return h.span(
		[
			node,
			h.Attribute("contenteditable", "false"),
			h.Attribute("role", "button"),
			h.Attribute("style", ""),
			h.Attribute("tabindex", "0"),
		],
		[
			h.img([
				h.Attribute("src", imageUrl),
				h.Attribute("alt", `:${name}:`),
				h.Class("inline-block size-5 align-text-bottom"),
			]),
			voidChildView(h),
		],
	)
}

const elementView = <M>(h: HtmlBuilder<M>, element: CustomElement, path: Path, refs: MarkdownRefs): Html => {
	if (element.type === "code-block") return codeBlockView(h, element, path)
	if (element.type === "mention") return mentionView(h, element, refs)
	if (element.type === "custom-emoji") return customEmojiView(h, element, refs)
	const children = childrenOf(element).map((child, index) =>
		isText(child)
			? textView(h, child, [...path, index], element, index)
			: elementView(h, child as CustomElement, [...path, index], refs),
	)
	const node = h.Attribute("data-slate-node", "element")
	if (element.type === "paragraph") return h.p([node, h.Class("my-0 last:empty:hidden")], children)
	if (element.type === "list-item") return h.li([node, h.Class("my-0.5 ml-4")], children)
	if (element.type === "subtext") return h.p([node, h.Class("my-0 text-muted-fg text-xs")], children)
	if (element.type === "blockquote")
		return h.blockquote(
			[node, h.Class("relative my-1 pl-4 italic")],
			[
				h.span([
					h.Class("absolute top-0 left-0 h-full w-1 rounded-xs bg-primary"),
					h.Attribute("aria-hidden", "true"),
				]),
				...children,
			],
		)
	if (element.type === "heading") {
		const tag = element.level === 1 ? h.h1 : element.level === 2 ? h.h2 : h.h3
		return tag([node, h.Class(headingClass(element.level))], children)
	}
	if (element.type === "table") return tableView(h, element, children)
	if (element.type === "table-row") return h.tr([node], children)
	if (element.type === "table-cell") {
		const align = "align" in element ? element.align : undefined
		const isHeader = "header" in element && element.header
		const cellClasses = cx(
			"border border-border px-3 py-2",
			align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left",
		)
		return isHeader
			? h.th([node, h.Class(cx(cellClasses, "font-medium"))], children)
			: h.td([node, h.Class(cellClasses)], children)
	}
	return h.p([node], children)
}

/** `TableElement`: the first row goes in a `thead` when it has header cells. */
const tableView = <M>(h: HtmlBuilder<M>, element: CustomElement, children: ReadonlyArray<Html>): Html => {
	const firstRow = childrenOf(element)[0]
	const hasHeader =
		firstRow !== undefined &&
		!isText(firstRow) &&
		childrenOf(firstRow as CustomElement).some((cell) => "header" in cell && cell.header)
	return h.div(
		[h.Attribute("data-slate-node", "element"), h.Class("my-2 overflow-x-auto")],
		[
			h.table(
				[h.Class("w-full border-collapse text-sm")],
				hasHeader
					? [h.thead([h.Class("bg-muted")], children.slice(0, 1)), h.tbody([], children.slice(1))]
					: [h.tbody([], [...children])],
			),
		],
	)
}

/** `SlateMessageViewer`. */
export const markdownView = <M>(h: HtmlBuilder<M>, content: string, refs: MarkdownRefs = NO_REFS): Html => {
	const value: ReadonlyArray<CustomDescendant> = deserializeFromMarkdown(content)
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
					isText(node)
						? h.span([], [node.text])
						: elementView(h, node as CustomElement, [index], refs),
				),
			),
		],
	)
}
