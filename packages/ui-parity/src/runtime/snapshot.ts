/**
 * Structural snapshot of what is on screen, collected inside the page.
 *
 * The two apps will not share DOM structure (React Aria wrappers vs Foldkit views),
 * so elements are matched on what the user perceives instead:
 *
 * - text runs: every visible text node, keyed by its text (+ occurrence index)
 * - controls: elements with an accessible role, keyed by role + name
 *
 * Each record carries its box and the computed styles that decide how it looks,
 * so a diff can say "button 'Attach': padding-left 8px → 6px" instead of only
 * "some pixels are red".
 */

export const TEXT_STYLE_PROPS = [
	"font-family",
	"font-size",
	"font-weight",
	"font-style",
	"line-height",
	"letter-spacing",
	"color",
	"text-decoration-line",
	"text-transform",
	"opacity",
] as const

export const BOX_STYLE_PROPS = [
	"background-color",
	"background-image",
	"color",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
	"border-top-color",
	"border-top-style",
	"border-top-left-radius",
	"border-top-right-radius",
	"border-bottom-left-radius",
	"border-bottom-right-radius",
	"padding-top",
	"padding-right",
	"padding-bottom",
	"padding-left",
	"box-shadow",
	"outline-style",
	"outline-width",
	"outline-color",
	"opacity",
	"gap",
	"font-size",
	"font-weight",
	"cursor",
] as const

export interface Rect {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

export interface SnapshotNode {
	readonly kind: "text" | "control"
	/** Stable identity used to pair nodes across the two apps. */
	readonly key: string
	readonly label: string
	readonly rect: Rect
	readonly styles: Record<string, string>
	/** CSS-ish path for humans, e.g. `nav > ul > li:nth-child(2) > a`. */
	readonly path: string
}

export interface DomSnapshot {
	readonly viewport: { readonly width: number; readonly height: number }
	readonly nodes: ReadonlyArray<SnapshotNode>
}

export const collectSnapshot = (input: {
	textProps: ReadonlyArray<string>
	boxProps: ReadonlyArray<string>
}): DomSnapshot => {
	const round = (value: number) => Math.round(value * 10) / 10
	const toRect = (rect: DOMRect): Rect => ({
		x: round(rect.x),
		y: round(rect.y),
		width: round(rect.width),
		height: round(rect.height),
	})
	const vw = window.innerWidth
	const vh = window.innerHeight
	const onScreen = (rect: DOMRect) =>
		rect.width > 0 &&
		rect.height > 0 &&
		rect.bottom > 0 &&
		rect.right > 0 &&
		rect.top < vh &&
		rect.left < vw

	const isVisible = (element: Element) => {
		const style = getComputedStyle(element)
		return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.01
	}

	const pathOf = (element: Element) => {
		const parts: string[] = []
		let node: Element | null = element
		while (node && node !== document.body && parts.length < 6) {
			const parent: Element | null = node.parentElement
			let part = node.tagName.toLowerCase()
			if (parent) {
				const siblings = [...parent.children].filter((child) => child.tagName === node!.tagName)
				if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`
			}
			parts.unshift(part)
			node = parent
		}
		return parts.join(" > ")
	}

	const pick = (element: Element, props: ReadonlyArray<string>) => {
		const style = getComputedStyle(element)
		return Object.fromEntries(props.map((prop) => [prop, style.getPropertyValue(prop)]))
	}

	const occurrences = new Map<string, number>()
	const keyed = (base: string) => {
		const count = occurrences.get(base) ?? 0
		occurrences.set(base, count + 1)
		return count === 0 ? base : `${base}#${count + 1}`
	}

	const nodes: SnapshotNode[] = []

	// Text runs, in document order.
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
	for (let text = walker.nextNode(); text; text = walker.nextNode()) {
		const content = text.textContent?.replace(/\s+/g, " ").trim()
		const parent = text.parentElement
		if (!content || !parent || parent.closest("script, style, [data-parity-ignore]")) continue
		if (!isVisible(parent)) continue
		const range = document.createRange()
		range.selectNodeContents(text)
		const rect = range.getBoundingClientRect()
		if (!onScreen(rect)) continue
		nodes.push({
			kind: "text",
			key: keyed(`text:${content.slice(0, 80)}`),
			label: content.slice(0, 80),
			rect: toRect(rect),
			styles: pick(parent, input.textProps),
			path: pathOf(parent),
		})
	}

	// Controls and landmarks with an accessible role.
	const roleSelector =
		"button, a[href], input, textarea, select, [role], [contenteditable=true], img, svg, nav, aside, header, main, dialog"
	for (const element of document.body.querySelectorAll(roleSelector)) {
		if (element.closest("[data-parity-ignore]")) continue
		const rect = element.getBoundingClientRect()
		if (!onScreen(rect) || !isVisible(element)) continue
		// Inline SVGs inside a control are covered by the control itself.
		if (element.tagName === "svg" && element.parentElement?.closest("button, a, [role]")) continue
		const role = element.getAttribute("role") ?? element.tagName.toLowerCase()
		const name = (
			element.getAttribute("aria-label") ??
			element.getAttribute("alt") ??
			element.getAttribute("placeholder") ??
			element.getAttribute("title") ??
			element.textContent ??
			""
		)
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 60)
		nodes.push({
			kind: "control",
			key: keyed(`${role}:${name}`),
			label: `${role} "${name}"`,
			rect: toRect(rect),
			styles: pick(element, input.boxProps),
			path: pathOf(element),
		})
	}

	return { viewport: { width: vw, height: vh }, nodes }
}
