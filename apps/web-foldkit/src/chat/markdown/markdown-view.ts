import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { isEmojiOnly } from "~/lib/emoji-utils"
import { cn } from "~/lib/utils"
import { cx } from "~/utils/cx"
import { deserializeFromMarkdown } from "../../editor/markdown"
import type { ProseMirrorNode } from "../../editor/schema"
import { IconCopy } from "../../icons"
import { codeBlockLeaves, textLeaves, textNodeView, voidChildView } from "./leaves"

/**
 * Port of `SlateMessageViewer` as a pure view: the composer's parse (`editor/markdown.ts`) and
 * decorations (`editor/decorations.ts`), rendered as the DOM a read-only Slate `Editable` produces,
 * with no editor instance per message (plan §3.4).
 */

/** What the viewer resolves outside the markdown: mention names and custom emoji images. */
export interface MarkdownRefs {
	readonly mentions: ReadonlyArray<{ readonly userId: string; readonly name: string }>
	readonly emojis: ReadonlyArray<{ readonly name: string; readonly imageUrl: string }>
}

export const NO_REFS: MarkdownRefs = { mentions: [], emojis: [] }

/**
 * Wraps a user mention's button in an overlay trigger (the profile popover). `index` counts the
 * message's user mentions in document order, so two mentions of one user get their own trigger.
 */
export type MentionTrigger = (
	mention: { readonly userId: string; readonly index: number },
	toTrigger: (attributes: ReadonlyArray<ChildAttribute>) => Html,
) => Html

/** One render's inputs: the refs, the mention trigger, and the user mentions rendered so far. */
interface Env {
	readonly refs: MarkdownRefs
	readonly mentionTrigger: MentionTrigger | undefined
	mentionCount: number
}

const childrenOf = (node: ProseMirrorNode): ReadonlyArray<ProseMirrorNode> => {
	const children: Array<ProseMirrorNode> = []
	node.forEach((child) => children.push(child))
	return children
}

/** A text child of `parent` (Slate keeps an empty text in an empty block; ProseMirror has none). */
const textView = <M>(h: HtmlBuilder<M>, text: string, parent: ProseMirrorNode, isLastText: boolean) =>
	textNodeView(h, textLeaves(text), { isLastText, isBlockEmpty: parent.textContent === "" })

const headingClass = (level: number) =>
	level === 1
		? cx("font-semibold tracking-tight", "mt-4 mb-2 text-2xl first:mt-0")
		: level === 2
			? cx("font-semibold tracking-tight", "mt-3 mb-1.5 text-xl first:mt-0")
			: cx("font-semibold tracking-tight", "mt-2 mb-1 text-lg first:mt-0")

const COLLAPSE_THRESHOLD = 15

/** `CodeBlockElement` with controls; collapsing past 15 lines starts collapsed. */
const codeBlockView = <M>(h: HtmlBuilder<M>, element: ProseMirrorNode): Html => {
	const codeText = element.textContent
	const language: string = element.attrs.language || "plaintext"
	const lineCount = codeText.split("\n").length
	const isCollapsible = lineCount > COLLAPSE_THRESHOLD
	const code = [
		textNodeView(h, codeBlockLeaves(codeText, element.attrs.language), {
			isLastText: true,
			isBlockEmpty: codeText === "",
		}),
	]
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
const mentionView = <M>(h: HtmlBuilder<M>, element: ProseMirrorNode, env: Env): Html => {
	const userId: string = element.attrs.userId
	const displayName: string = element.attrs.displayName
	const node = h.Attribute("data-slate-node", "element")
	if (userId === "channel" || userId === "here")
		return h.span(
			[node, h.Attribute("contenteditable", "false"), h.Class(cn(MENTION_CLASS))],
			["@", displayName, voidChildView(h)],
		)
	const fullName = env.refs.mentions.find((mention) => mention.userId === userId)?.name ?? displayName
	const index = env.mentionCount++
	const toTrigger = (attributes: ReadonlyArray<ChildAttribute>) =>
		h.button(
			[
				// The trigger's attributes carry its own `aria-expanded` and `type`.
				...(attributes.length === 0
					? [h.Attribute("aria-expanded", "false"), h.Type("button")]
					: attributes),
				h.Class(
					cn(
						"inline-block cursor-pointer rounded bg-primary/10 px-1 py-0.5 align-baseline font-medium text-primary outline-hidden transition-colors hover:bg-primary/20",
					),
				),
				h.Attribute("data-react-aria-pressable", "true"),
				node,
				h.Attribute("tabindex", "0"),
			],
			["@", fullName, voidChildView(h)],
		)
	return env.mentionTrigger === undefined ? toTrigger([]) : env.mentionTrigger({ userId, index }, toTrigger)
}

/** `CustomEmojiElement`: the org's image, or `:name:` when the org has no such emoji. */
const customEmojiView = <M>(h: HtmlBuilder<M>, element: ProseMirrorNode, { refs }: Env): Html => {
	const name: string = element.attrs.name
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

const elementView = <M>(h: HtmlBuilder<M>, element: ProseMirrorNode, env: Env): Html => {
	const type = element.type.name
	if (type === "code-block") return codeBlockView(h, element)
	if (type === "mention") return mentionView(h, element, env)
	if (type === "custom-emoji") return customEmojiView(h, element, env)
	const elementChildren = childrenOf(element)
	const children =
		element.inlineContent && elementChildren.length === 0
			? [textView(h, "", element, true)]
			: elementChildren.map((child, index) =>
					child.isText
						? textView(h, child.text ?? "", element, index === elementChildren.length - 1)
						: elementView(h, child, env),
				)
	const node = h.Attribute("data-slate-node", "element")
	// A blank line in the markdown: half a line of space, not a whole empty one.
	if (type === "paragraph" && element.content.size === 0)
		return h.div([node, h.Class("h-2"), h.AriaHidden(true)])
	if (type === "paragraph") return h.p([node, h.Class("my-0 last:empty:hidden")], children)
	if (type === "list-item")
		return h.li(
			[
				node,
				h.Class(
					cx(
						"my-0.5 ml-5 pl-1",
						element.attrs.ordered ? "list-decimal" : "list-disc marker:text-muted-fg",
					),
				),
			],
			children,
		)
	if (type === "subtext") return h.p([node, h.Class("my-0 text-muted-fg text-xs")], children)
	if (type === "blockquote")
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
	if (type === "heading") {
		const level: number = element.attrs.level
		const tag = level === 1 ? h.h1 : level === 2 ? h.h2 : h.h3
		return tag([node, h.Class(headingClass(level))], children)
	}
	if (type === "table") return tableView(h, element, children)
	if (type === "table-row") return h.tr([node], children)
	if (type === "table-cell") {
		const align: string | null = element.attrs.align
		const isHeader: boolean = element.attrs.header
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
const tableView = <M>(h: HtmlBuilder<M>, element: ProseMirrorNode, children: ReadonlyArray<Html>): Html => {
	const firstRow = element.firstChild
	const hasHeader = firstRow !== null && childrenOf(firstRow).some((cell) => cell.attrs.header === true)
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
export const markdownView = <M>(
	h: HtmlBuilder<M>,
	content: string,
	refs: MarkdownRefs = NO_REFS,
	mentionTrigger?: MentionTrigger,
): Html => {
	const blocks = deserializeFromMarkdown(content, { paragraphBreaks: true })
	const env: Env = { refs, mentionTrigger, mentionCount: 0 }
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
				blocks.map((block) => elementView(h, block, env)),
			),
		],
	)
}
