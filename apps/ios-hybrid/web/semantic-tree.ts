/**
 * Reads the semantic tree (`web-foldkit/src/ui/semantic.ts`) out of the page the web renderer drew,
 * for the SwiftUI renderer. A spike's transport: the real one would take Foldkit's committed tree
 * through a `RenderTarget` instead of the DOM (`docs/cross-platform-ui.md`).
 *
 * - An element with `data-ui` is a node: its kind, its props, and the nodes under it.
 * - Inside a node, the markup is the web's drawing of it: only nested nodes count.
 * - Outside every node, text the page shows is something the screen has not converted yet: it
 *   comes through as an `unconverted` node, so a native screen shows where it is incomplete.
 */
import { type Look, lookOf, plainLookOf, withMenuIcons } from "./look"

export type TreeNode =
	| Readonly<{
			id: string
			kind: string
			props: Record<string, unknown>
			/** How the web draws it (`look.ts`): what the native renderer draws it like. */
			look: Look
			children: Array<TreeNode>
	  }>
	| Readonly<{ id: string; kind: "unconverted"; props: { text: string }; look: Look; children: [] }>

/** Kinds that hold other nodes; the rest draw their whole element. */
const CONTAINERS = new Set(["screen", "section"])

const ids = new WeakMap<Element, string>()
let nextId = 0
/** The element each node stands for, from the last read: what a press on the node replays on. */
let elements = new Map<string, Element>()

const idOf = (element: Element): string => {
	const existing = ids.get(element)
	if (existing !== undefined) return existing
	const id = `n${nextId++}`
	ids.set(element, id)
	return id
}

/** Not drawn: hidden by markup, or by the stylesheet (a closed sheet, a phone-hidden column). */
const isHidden = (element: Element): boolean =>
	// `display: contents` has no box of its own, which `checkVisibility` reads as hidden.
	(!element.checkVisibility() && getComputedStyle(element).display !== "contents") ||
	element.hasAttribute("hidden") ||
	element.getAttribute("aria-hidden") === "true" ||
	element.classList.contains("sr-only") ||
	(element instanceof HTMLElement && element.style.display === "none")

const ownText = (element: Element): string =>
	Array.from(element.childNodes)
		.filter((node) => node.nodeType === Node.TEXT_NODE)
		.map((node) => node.textContent ?? "")
		.join("")
		.trim()

const parseProps = (element: Element): Record<string, unknown> => {
	try {
		return JSON.parse(element.getAttribute("data-ui-props") ?? "{}")
	} catch {
		return {}
	}
}

const collect = (
	element: Element,
	isInsideNode: boolean,
	out: Array<TreeNode>,
	seen: Map<string, Element>,
	screen: Element,
	/** The enclosing container's title: its header text is the container's own, not unconverted. */
	ownTitle = "",
) => {
	if (isHidden(element)) return
	const kind = element.getAttribute("data-ui")
	if (kind !== null) {
		const id = idOf(element)
		seen.set(id, element)
		const props = parseProps(element)
		// A row's long-press menu (`nativeContextMenu`) goes with it.
		if (kind === "item" && element.getAttribute("data-native") === "context-menu") {
			props.menu = withMenuIcons(JSON.parse(element.getAttribute("data-native-props") ?? "{}"))
		}
		// A press that opens a menu (`nativeIsland(h, "menu")`): the native menu, not the web's.
		if (element.getAttribute("data-native") === "menu") {
			props.pullDown = withMenuIcons(JSON.parse(element.getAttribute("data-native-props") ?? "{}"))
		}
		// A container's content is its own nodes, and what it has not converted; a row or a
		// button is drawn by its node, so only nested nodes count in it.
		const isContainer = CONTAINERS.has(kind)
		const children: Array<TreeNode> = []
		const title = typeof props.title === "string" ? props.title : ""
		for (const child of Array.from(element.children))
			collect(child, !isContainer, children, seen, screen, title)
		out.push({ id, kind, props, look: lookOf(kind, element, props, screen), children })
		return
	}
	if (!isInsideNode) {
		const text = ownText(element)
		if (text.length > 0 && text === ownTitle) return
		if (text.length > 0 || element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
			const id = idOf(element)
			seen.set(id, element)
			const shown = (element instanceof HTMLElement ? element.innerText : text)
				.trim()
				.replace(/\s+/g, " ")
			// The container's header (a section's title, in its collapse button) is the container's.
			if (ownTitle.length > 0 && shown === ownTitle) return
			const label = shown || element.getAttribute("aria-label") || element.tagName.toLowerCase()
			out.push({
				id,
				kind: "unconverted",
				props: { text: label.slice(0, 80) },
				look: plainLookOf(element, screen),
				children: [],
			})
			return
		}
	}
	for (const child of Array.from(element.children))
		collect(child, isInsideNode, out, seen, screen, ownTitle)
}

/** The screen the page shows, as nodes; `null` when no part of it is converted. */
export const readScreen = (): TreeNode | null => {
	const screen = Array.from(document.querySelectorAll('[data-ui="screen"]')).find((element) =>
		element.checkVisibility(),
	)
	if (screen === undefined) return null
	const seen = new Map<string, Element>()
	const out: Array<TreeNode> = []
	collect(screen, false, out, seen, screen)
	elements = seen
	return out[0] ?? null
}

/** A press on node `id`: an item follows its link (or is pressed itself), anything else is clicked. */
export const press = (id: string) => {
	const element = elements.get(id)
	if (element === undefined) return
	const target =
		element.getAttribute("data-ui") === "item" ? (element.querySelector("a[href]") ?? element) : element
	if (target instanceof HTMLElement) target.click()
}

/** A choice from node `id`'s long-press menu, replayed as the `change` its island listens for. */
export const chooseFromMenu = (id: string, key: string) => {
	const element = elements.get(id)
	if (element === undefined) return
	Object.assign(element, { value: key })
	element.dispatchEvent(new Event("change", { bubbles: true }))
}
