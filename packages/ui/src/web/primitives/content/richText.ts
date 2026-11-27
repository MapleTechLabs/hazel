// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { BlockKind, RunKind, type Block, type Run } from "../../../vocabulary/content.ts"
import { glyph } from "../../icons.ts"
import { definePrimitive, part, type Primitive } from "../define.ts"
import { highlight } from "./code.ts"
import { ensureStyles } from "./styles.ts"

/**
 * A code block as `markdown-view.ts` draws it: the highlighted code in a well, and over its corner the
 * language (an `info` pill, none for plain text) and the copy button, shown on hover (`data-block` is
 * the block's index, what `copyCode` reports); a block past 15 lines is clipped.
 */
const codeBlock = (document: Document, source: string, language: string, block: number) => {
	const frame = part(document, "div", "codeFrame")
	const tools = part(document, "div", "codeTools")
	const named = language !== "" && language.toLowerCase() !== "plaintext"
	if (named) {
		const badge = part(document, "span", "codeLanguage")
		badge.textContent = language
		tools.append(badge)
	}
	const copy = part(document, "button", "codeCopy")
	copy.setAttribute("type", "button")
	copy.setAttribute("title", "Copy code")
	copy.setAttribute("aria-label", "Copy code")
	copy.dataset.block = String(block)
	const icon = part(document, "span", "codeCopyIcon")
	icon.setAttribute("aria-hidden", "true")
	glyph(icon, "copy")
	copy.append(icon)
	tools.append(copy)
	const pre = part(document, "pre", "codeBlock")
	if (named) pre.dataset.named = ""
	// Past 15 lines the block is clipped at 320px, as today's (no control opens it).
	if (source.split("\n").length > 15) pre.dataset.collapsed = ""
	const code = document.createElement("code")
	if (language !== "") code.dataset.language = language
	code.append(...highlight(document, source, language))
	pre.append(code)
	frame.append(tools, pre)
	return frame
}

/**
 * Blocks to DOM. Runs are numbered in reading order across the whole value (`data-hz-run`): what
 * `pressMention` reports as `run`, so a popover can anchor at that mention (`popover.anchorTo`,
 * `[data-hz-key=key] [data-hz-run=run]`).
 */
const render = (document: Document, blocks: ReadonlyArray<Block>) => {
	let index = 0
	const run = (value: Run): Node => {
		const at = index++
		if (typeof value === "string") return document.createTextNode(value)
		const [kind, text] = value
		let node: HTMLElement
		if (kind === RunKind.mention) {
			node = part(document, "button", "mention")
			node.setAttribute("type", "button")
			node.dataset.userId = value[2]
			node.textContent = text
		} else if (kind === RunKind.link) {
			node = part(document, "a", "link")
			node.setAttribute("href", value[2])
			node.setAttribute("rel", "noopener noreferrer")
			node.setAttribute("target", "_blank")
			node.textContent = text
		} else if (kind === RunKind.code) {
			// The `code` element brings the monospace face (the part's own font is reset).
			node = part(document, "span", "code")
			const code = document.createElement("code")
			code.textContent = text
			node.append(code)
		} else if (kind === RunKind.strong) {
			node = part(document, "strong", "strong")
			node.textContent = text
		} else {
			// Not parts, so the elements keep the browser's italic and line-through.
			node = document.createElement(kind === RunKind.emphasis ? "em" : "s")
			node.textContent = text
		}
		node.dataset.hzRun = String(at)
		return node
	}
	const line = (runs: ReadonlyArray<Run>, marker?: string) => {
		const node = part(document, "p", "line")
		if (marker !== undefined) {
			const mark = part(document, "span", "marker")
			mark.textContent = marker
			node.append(mark)
		}
		node.append(...runs.map(run))
		return node
	}
	return blocks.map((block, index): HTMLElement => {
		if (block[0] === BlockKind.paragraph) return line(block[1])
		if (block[0] === BlockKind.item) return line(block[1], block[2])
		if (block[0] === BlockKind.quote) {
			const quote = part(document, "blockquote", "quote")
			const italic = document.createElement("em")
			italic.append(...block[1].map(run))
			quote.append(italic)
			return quote
		}
		return codeBlock(document, block[1], block[2], index)
	})
}

export const primitive = definePrimitive("richText", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	let last: unknown
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name !== "blocks" || value === last) return
			last = value
			// SAFETY: `blocks` crosses the wire as `Content.RichText` (`spec.ts` types the prop with it).
			node.replaceChildren(
				...render(document, Array.isArray(value) ? (value as ReadonlyArray<Block>) : []),
			)
		},
		events: undefined,
	}
	node.addEventListener("click", (event) => {
		const copy = event.target instanceof Element ? event.target.closest("[data-hz-part=codeCopy]") : null
		const copyCode = primitive.events?.handlers.copyCode
		if (copy instanceof HTMLElement && node.contains(copy)) {
			if (primitive.events !== undefined && copyCode !== undefined)
				primitive.events.dispatch("copyCode", copyCode, { block: Number(copy.dataset.block) })
			return
		}
		const target = event.target instanceof Element ? event.target.closest("[data-hz-run]") : null
		const events = primitive.events
		if (!(target instanceof HTMLElement) || events === undefined || !node.contains(target)) return
		const run = Number(target.dataset.hzRun)
		const mention = events.handlers.pressMention
		const link = events.handlers.pressLink
		if (target.dataset.hzPart === "mention" && mention !== undefined)
			events.dispatch("pressMention", mention, { userId: target.dataset.userId ?? "", run })
		else if (target instanceof HTMLAnchorElement && link !== undefined) {
			// A handled link is the view's to open; an unhandled one opens as a plain link.
			event.preventDefault()
			events.dispatch("pressLink", link, { url: target.getAttribute("href") ?? "" })
		}
	})
	return primitive
})
