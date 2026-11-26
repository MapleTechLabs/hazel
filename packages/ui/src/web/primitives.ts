/**
 * What each `hz:*` tag is in the DOM (G1). Structure is built once at create time with one content
 * parent for the renderer's children; props later only change attributes, text and internal swaps.
 */
import { dispose, mountExtension } from "./extensions.ts"
import { createTextField } from "./textField.ts"

export interface Events {
	readonly handlers: Readonly<Record<string, unknown>>
	readonly dispatch: (event: string, handler: any, payload: unknown) => boolean
}

/** One `hz:*` element: its outer node, the node its children go in, and how it applies a prop. */
export interface Primitive {
	readonly tag: string
	readonly outer: HTMLElement
	readonly content: HTMLElement
	readonly set: (name: string, value: unknown) => void
	events: Events | undefined
}

const part = (document: Document, tagName: string, name: string) => {
	const node = document.createElement(tagName)
	node.dataset.hzPart = name
	return node
}

const flag = (node: HTMLElement, name: string, value: unknown) => {
	if (value === true) node.setAttribute(`data-${name}`, "")
	else node.removeAttribute(`data-${name}`)
}

const option = (node: HTMLElement, name: string, value: unknown) => {
	if (typeof value === "string") node.setAttribute(`data-${name}`, value)
	else node.removeAttribute(`data-${name}`)
}

const icons: Record<string, string> = {
	hashtag: '<path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16"/>',
	lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	"chevron-down": '<path d="m6 9 6 6 6-6"/>',
	sparkles: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
}

const svg = (name: string) =>
	`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name] ?? ""}</svg>`

export const create = (document: Document, tag: string): Primitive | undefined => {
	const outer = (tagName: string) => {
		const node = document.createElement(tagName)
		node.dataset.hz = tag.slice(3)
		return node
	}
	const self = (node: HTMLElement, set: Primitive["set"]): Primitive => ({
		tag,
		outer: node,
		content: node,
		set,
		events: undefined,
	})

	switch (tag) {
		case "hz:screen": {
			const node = outer("main")
			const header = part(document, "header", "header")
			const title = part(document, "h1", "title")
			const content = part(document, "div", "content")
			header.append(title)
			node.append(header, content)
			return {
				tag,
				outer: node,
				content,
				set: (name, value) => {
					if (name === "title") title.textContent = typeof value === "string" ? value : ""
				},
				events: undefined,
			}
		}
		case "hz:section": {
			const node = outer("section")
			const title = part(document, "h2", "title")
			const content = part(document, "div", "content")
			node.append(title, content)
			return {
				tag,
				outer: node,
				content,
				set: (name, value) => {
					if (name === "title") {
						title.textContent = typeof value === "string" ? value : ""
						node.setAttribute("aria-label", title.textContent)
					}
				},
				events: undefined,
			}
		}
		case "hz:item": {
			const node = outer("div")
			const content = part(document, "span", "content")
			const title = part(document, "span", "title")
			const badge = part(document, "span", "badge")
			badge.hidden = true
			let control: HTMLElement = part(document, "button", "control")
			control.setAttribute("type", "button")
			control.append(content, title, badge)
			node.append(control)
			let selected = false
			// Link vs button: a new control takes the same three parts, so the content parent never moves
			// out of the item and the renderer's nodes are untouched.
			const swap = (href: string | undefined) => {
				const wanted = href === undefined ? "BUTTON" : "A"
				if (control.tagName !== wanted) {
					const next = part(document, wanted.toLowerCase(), "control")
					if (wanted === "BUTTON") next.setAttribute("type", "button")
					next.append(...control.childNodes)
					control.replaceWith(next)
					control = next
				}
				if (href !== undefined) control.setAttribute("href", href)
				if (selected) control.setAttribute("aria-current", "page")
				else control.removeAttribute("aria-current")
			}
			return {
				tag,
				outer: node,
				content,
				set: (name, value) => {
					if (name === "title") title.textContent = typeof value === "string" ? value : ""
					else if (name === "badge") {
						badge.hidden = typeof value !== "number"
						badge.textContent = typeof value === "number" ? String(value) : ""
					} else if (name === "href") swap(typeof value === "string" ? value : undefined)
					else if (name === "selected") {
						selected = value === true
						flag(node, "selected", value)
						swap(control.getAttribute("href") ?? undefined)
					} else if (name === "emphasized") flag(node, "emphasized", value)
				},
				events: undefined,
			}
		}
		case "hz:text": {
			const node = outer("span")
			return self(node, (name, value) => {
				if (name === "strong") flag(node, "strong", value)
				else if (name === "role" || name === "tone") option(node, name, value)
			})
		}
		case "hz:icon": {
			const node = outer("span")
			node.setAttribute("aria-hidden", "true")
			return self(node, (name, value) => {
				if (name !== "name") return
				option(node, "name", value)
				node.innerHTML = svg(String(value))
			})
		}
		case "hz:avatar": {
			const node = outer("span")
			node.setAttribute("aria-hidden", "true")
			return self(node, (name, value) => {
				if (name === "initials") node.textContent = typeof value === "string" ? value : ""
			})
		}
		case "hz:slot": {
			const node = outer("span")
			return self(node, (name, value) => {
				if (name !== "name") return
				option(node, "name", value)
				// What the owner's recipe targets (`[data-hz-slot=leading]`).
				option(node, "hz-slot", value)
			})
		}
		case "hz:action": {
			const node = outer("button")
			node.setAttribute("type", "button")
			return self(node, (name, value) => {
				if (name === "label") {
					if (typeof value === "string") node.setAttribute("aria-label", value)
					else node.removeAttribute("aria-label")
				}
			})
		}
		case "hz:ext": {
			const node = outer("div")
			const surface = part(document, "div", "surface")
			const content = part(document, "div", "content")
			// One of the two shows: the platform's drawing once drawn, else the fallback.
			surface.hidden = true
			node.append(surface, content)
			let ext: string | undefined
			let args: unknown
			const primitive: Primitive = {
				tag,
				outer: node,
				content,
				set: (name, value) => {
					if (name === "args") args = value
					else if (name === "ext") ext = typeof value === "string" ? value : undefined
					else return
					if (ext !== undefined) node.dataset.ext = ext
					// Props arrive one at a time after create: draw once both name and args are known.
					if (ext === undefined || args === undefined) return
					const send = (event: string, payload: unknown) => {
						const handler = primitive.events?.handlers[event]
						return handler !== undefined && primitive.events!.dispatch(event, handler, payload)
					}
					// Drawn here if this platform registered it; else the fallback slot shows.
					if (mountExtension(surface, ext, args, send)) {
						node.dataset.drawn = ""
						surface.hidden = false
						content.hidden = true
					}
				},
				events: undefined,
			}
			return primitive
		}
		case "hz:textField":
			return createTextField(document, outer("div"))
		default:
			return undefined
	}
}

/** Before a subtree leaves: ends the extension instances in it. */
export const release = (node: Node) => {
	if (!(node instanceof Element)) return
	const all = node.matches("[data-hz=ext]") ? [node] : []
	for (const ext of [...all, ...node.querySelectorAll("[data-hz=ext]")]) {
		const surface = ext.querySelector(":scope > [data-hz-part=surface]")
		if (surface !== null) dispose(surface)
	}
}
