// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { BlockKind, RunKind, type Block, type Run } from "../../../vocabulary/content.ts"
import { definePrimitive, part, type Primitive } from "../define.ts"

/**
 * Blocks to DOM. Runs are numbered in reading order across the whole value (`data-run`): what
 * `pressMention` reports as `run`, so a popover can anchor at that mention (`popover.anchorTo`).
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
		node.dataset.run = String(at)
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
	return blocks.map((block): HTMLElement => {
		if (block[0] === BlockKind.paragraph) return line(block[1])
		if (block[0] === BlockKind.item) return line(block[1], block[2])
		if (block[0] === BlockKind.quote) {
			const quote = part(document, "blockquote", "quote")
			const italic = document.createElement("em")
			italic.append(...block[1].map(run))
			quote.append(italic)
			return quote
		}
		const pre = part(document, "pre", "codeBlock")
		// Renderer-owned: long lines scroll inside the well.
		pre.style.overflowX = "auto"
		pre.style.whiteSpace = "pre-wrap"
		const code = document.createElement("code")
		if (block[2] !== "") code.dataset.language = block[2]
		code.textContent = block[1]
		pre.append(code)
		return pre
	})
}

export const primitive = definePrimitive("richText", ({ document, tag, outer }) => {
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
		const target = event.target instanceof Element ? event.target.closest("[data-run]") : null
		const events = primitive.events
		if (!(target instanceof HTMLElement) || events === undefined || !node.contains(target)) return
		const run = Number(target.dataset.run)
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
