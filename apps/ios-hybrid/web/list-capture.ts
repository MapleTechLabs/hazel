/**
 * The message list for the native list (`HazelHybrid/NativeList.swift`): each row the web lays out
 * becomes a display list (text runs per line, boxes, images, tap regions), captured once and again
 * only when a mutation touches the row. The native side draws a row into a bitmap once and scrolls
 * bitmaps, so scrolling never waits on layout, text or JS.
 *
 * The web's list stays the layout engine (one view: markdown, code, reactions, embeds as the web
 * draws them); it is hidden under the native list and steered to render around what the native
 * list shows (`steer`).
 */
import { hex, iconKey, withMenuIcons } from "./look"

export type Font = { size: number; weight: number; mono: boolean; color: string; tracking: number }
type Rect = { x: number; y: number; w: number; h: number }
/** A rounded box its content is cut to (an ancestor's `overflow: hidden` with corners). */
type Clip = Rect & { r: number }
export type DisplayItem =
	| (Rect & { t: "box"; bg: string; radius: number; border?: string; bw?: number; clip?: Clip })
	| (Rect & { t: "text"; s: string; f: Font })
	| (Rect & { t: "image"; key: string; radius: number; clip?: Clip })
	| (Rect & { t: "url"; src: string; radius: number; fit: string; clip?: Clip })
	/** A framed page (an HTML render): drawn live by the native list, over the row (`FramePool`). */
	| (Rect & { t: "frame"; src: string; radius: number })

/** A row as the native list draws it. `hits` are its links and buttons, by element id. */
export type RowCapture = {
	key: string
	index: number
	/** Where the row starts across the screen (the native list spans it; the web's is inset). */
	x: number
	w: number
	h: number
	items: Array<DisplayItem>
	hits: Array<Rect & { id: string }>
	menu?: { id: string; props: unknown }
}

const ROW = "[data-list-key]"

const ids = new WeakMap<Element, string>()
const elements = new Map<string, WeakRef<Element>>()
let nextId = 0
const idOf = (element: Element) => {
	let id = ids.get(element)
	if (id === undefined) {
		id = `h${nextId++}`
		ids.set(element, id)
	}
	elements.set(id, new WeakRef(element))
	return id
}

const px = (value: string) => Number.parseFloat(value) || 0
const isVisible = (color: string) => hex(color).slice(7) !== "00"

const fontOf = (style: CSSStyleDeclaration): Font => ({
	size: px(style.fontSize),
	weight: Number(style.fontWeight) || 400,
	mono: /mono|menlo|courier|consolas/i.test(style.fontFamily),
	color: hex(style.color),
	tracking: style.letterSpacing === "normal" ? 0 : px(style.letterSpacing),
})

type Line = { s: string; x: number; y: number; r: number; h: number }

/**
 * A text node as lines: one run per line box, with the text that line holds. Words are measured
 * one by one (a word, with the spaces before it), so a run never spans a line break; in `pre`
 * text a newline ends the line.
 */
const textRuns = (node: Text, origin: DOMRect, style: CSSStyleDeclaration, out: Array<DisplayItem>) => {
	const text = node.data
	if (text.trim().length === 0) return
	const font = fontOf(style)
	const pre = style.whiteSpace.startsWith("pre")
	const range = document.createRange()
	let line: Line | undefined
	let pending = ""
	const flush = () => {
		if (line !== undefined && line.s.trim().length > 0) {
			out.push({
				t: "text",
				x: line.x,
				y: line.y,
				w: line.r - line.x,
				h: line.h,
				s: pre ? line.s : line.s.trim(),
				f: font,
			})
		}
		line = undefined
	}
	for (const match of text.matchAll(/\n|[^\S\n]+|\S+/g)) {
		const token = match[0]
		if (token === "\n") {
			if (pre) flush()
			pending = ""
			continue
		}
		if (token.trim().length === 0) {
			pending += token
			continue
		}
		range.setStart(node, match.index)
		range.setEnd(node, match.index + token.length)
		// A word that starts a wrapped line reports an empty box at the end of the line before it
		// first: its own box is the first with width.
		const rect = Array.from(range.getClientRects()).find((each) => each.width > 0)
		if (rect === undefined) continue
		const top = rect.top - origin.top
		if (line === undefined || Math.abs(line.y - top) > 1) {
			flush()
			// Spaces before a word that starts a line are not drawn (CSS drops them).
			line = {
				s: token,
				x: rect.left - origin.left,
				y: top,
				r: rect.right - origin.left,
				h: rect.height,
			}
		} else {
			line.s += pending + token
			line.r = rect.right - origin.left
		}
		pending = ""
	}
	flush()
}

/** A list item's marker: a bullet, or its number in an ordered list. */
const markerText = (item: Element, type: string): string | null => {
	const style = getComputedStyle(item)
	const kind = style.listStyleType !== "" ? style.listStyleType : type
	if (kind === "none") return null
	if (kind === "decimal") {
		const siblings = Array.from(item.parentElement?.children ?? []).filter(
			(each) => each.tagName === "LI",
		)
		const start = Number(item.parentElement?.getAttribute("start") ?? "1")
		return `${start + siblings.indexOf(item)}.`
	}
	return kind === "circle" ? "◦" : kind === "square" ? "▪" : "•"
}

const capture = (row: HTMLElement): RowCapture => {
	const origin = row.getBoundingClientRect()
	const items: Array<DisplayItem> = []
	const hits: RowCapture["hits"] = []
	let menu: RowCapture["menu"]
	const at = (rect: DOMRect): Rect => ({
		x: rect.left - origin.left,
		y: rect.top - origin.top,
		w: rect.width,
		h: rect.height,
	})
	const walk = (element: Element, outer: Clip | undefined) => {
		const style = getComputedStyle(element)
		if (style.display === "none" || px(style.opacity) === 0) return
		const rect = element.getBoundingClientRect()
		const clipped = <Item extends DisplayItem>(item: Item): Item =>
			outer === undefined ? item : { ...item, clip: outer }
		if (element.getAttribute("data-native") === "context-menu" && menu === undefined) {
			menu = {
				id: idOf(element),
				props: withMenuIcons(JSON.parse(element.getAttribute("data-native-props") ?? "{}")),
			}
		}
		if (element instanceof SVGSVGElement) {
			const key = iconKey(element)
			if (key !== undefined) items.push(clipped({ t: "image", ...at(rect), key, radius: 0 }))
			return
		}
		// Another origin's page: nothing to capture, so the native list shows it live where it is.
		if (element instanceof HTMLIFrameElement) {
			const src = element.getAttribute("src") ?? ""
			if (rect.width > 0 && rect.height > 0 && /^https?:/.test(src)) {
				items.push({ t: "frame", ...at(rect), src, radius: px(style.borderTopLeftRadius) })
			}
			return
		}
		if (element instanceof HTMLImageElement) {
			// Loaded or not: the native list loads pictures itself (`ImageLoader.swift`), so a row
			// never waits on the web's copy.
			const src = element.currentSrc || element.src
			if (rect.width > 0 && rect.height > 0 && /^(https?|data|hazel):/.test(src)) {
				items.push(
					clipped({
						t: "url",
						...at(rect),
						src,
						radius: px(style.borderTopLeftRadius),
						fit: style.objectFit,
					}),
				)
			}
			return
		}
		if (rect.width > 0 && rect.height > 0) {
			const borderWidth = px(style.borderTopWidth)
			const hasBorder = borderWidth > 0 && isVisible(style.borderTopColor)
			if (isVisible(style.backgroundColor) || hasBorder) {
				const box: DisplayItem = {
					t: "box",
					...at(rect),
					bg: hex(style.backgroundColor),
					radius: px(style.borderTopLeftRadius),
				}
				if (hasBorder) {
					box.border = hex(style.borderTopColor)
					box.bw = borderWidth
				}
				items.push(clipped(box))
			}
			const isPressable =
				element instanceof HTMLAnchorElement ||
				element instanceof HTMLButtonElement ||
				element.getAttribute("role") === "button"
			if (isPressable) hits.push({ id: idOf(element), ...at(rect) })
		}
		// A list item's bullet or number is a `::marker`, outside the DOM: drawn where CSS puts it,
		// in the gutter before the item's first line.
		if (style.display === "list-item" && element.parentElement !== null) {
			const marker = markerText(
				element,
				getComputedStyle(element.parentElement).listStyleType || style.listStyleType,
			)
			if (marker !== null) {
				const font = fontOf(style)
				const lineHeight = style.lineHeight === "normal" ? font.size * 1.2 : px(style.lineHeight)
				items.push({
					t: "text",
					x: rect.left - origin.left - font.size * (marker.length > 1 ? 1.4 : 1.1),
					y: rect.top - origin.top,
					w: font.size,
					h: lineHeight,
					s: marker,
					f: font,
				})
			}
		}
		// Corners that cut what is inside (an avatar's squircle, a picture's rounded frame).
		const radius = px(style.borderTopLeftRadius)
		const inner: Clip | undefined =
			style.overflowX !== "visible" && radius > 0 && rect.width > 0
				? { ...at(rect), r: Math.min(radius, rect.width / 2, rect.height / 2) }
				: outer
		for (const child of Array.from(element.childNodes)) {
			if (child instanceof Text) textRuns(child, origin, style, items)
			else if (child instanceof Element) walk(child, inner)
		}
	}
	for (const child of Array.from(row.children)) walk(child, undefined)
	const capture: RowCapture = {
		key: row.getAttribute("data-list-key") ?? "",
		index: Number(row.getAttribute("data-index") ?? "0"),
		x: origin.left,
		w: origin.width,
		h: origin.height,
		items,
		hits,
	}
	if (menu !== undefined) capture.menu = menu
	return capture
}

/** The list the page shows now (the channel's messages), or `null`. */
const listElement = (): HTMLElement | null => document.querySelector<HTMLElement>("[data-list-count]")

/** Rows a mutation touched since the last read, by key. */
let dirty = new Set<string>()
/** What the native list was sent, by key: a row is sent again only when it changed. */
const sent = new Map<string, string>()
/** The row order last sent (keys, joined). */
let sentOrder = ""
let sentList: string | null = null

export const noteMutations = (records: ReadonlyArray<MutationRecord>) => {
	for (const record of records) {
		const target = record.target instanceof Element ? record.target : record.target.parentElement
		const row = target?.closest(ROW)
		// The row's own index and offset change as rows load around it: a move, not new content.
		if (record.type === "attributes" && record.target === row) continue
		if (row !== null && row !== undefined) dirty.add(row.getAttribute("data-list-key") ?? "")
	}
}

export type ListUpdate = {
	/** The list's id (a new id is a new list: the native side starts over). */
	id: string
	/** How many rows the list has, rendered or not. */
	count: number
	/** Whether the list holds the newest row (a list paged back from it does not). */
	followsEnd: boolean
	/** Where the list is, in the web view's viewport. */
	frame: Rect
	rows: Array<RowCapture>
	/**
	 * Every row's key in index order, when it changed (older rows loaded above, the newest dropped
	 * as the window slides): the native list takes each row's place from it.
	 */
	order?: Array<string>
}

/** What changed in the list since the last read; `"gone"` when it went away, `null` when there is none. */
export const readList = (): ListUpdate | "gone" | null => {
	const list = listElement()
	if (list === null) {
		if (sentList === null) return null
		sentList = null
		sent.clear()
		sentOrder = ""
		return "gone"
	}
	const isNew = list.id !== sentList
	if (isNew) {
		sentList = list.id
		sent.clear()
		sentOrder = ""
	}
	const rect = list.getBoundingClientRect()
	const rows: Array<RowCapture> = []
	// Every row is laid out (`SystemUi.drawsLists`): the DOM holds the whole window.
	const elements = Array.from(list.querySelectorAll<HTMLElement>(ROW))
	const keys: Array<string> = []
	for (const row of elements)
		keys[Number(row.getAttribute("data-index") ?? "0")] = row.getAttribute("data-list-key") ?? ""
	const order = keys.join("\n")
	const hasNewOrder = order !== sentOrder
	sentOrder = order
	// A row the window dropped is gone from the native list too: if it comes back (the window
	// slides back), it is sent again.
	if (hasNewOrder) {
		const held = new Set(keys)
		for (const key of sent.keys()) if (!held.has(key)) sent.delete(key)
	}
	for (const row of elements) {
		const key = row.getAttribute("data-list-key") ?? ""
		const height = row.getBoundingClientRect().height
		// What it looks like; where it is comes with `order` (a move redraws nothing).
		const signature = `${Math.round(height)}:${Math.round(rect.width)}`
		if (!dirty.has(key) && sent.get(key) === signature) continue
		rows.push(capture(row))
		sent.set(key, signature)
	}
	dirty = new Set()
	const update: ListUpdate = {
		id: list.id,
		count: Number(list.getAttribute("data-list-count") ?? "0"),
		followsEnd: list.getAttribute("data-list-follows-end") !== "false",
		frame: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
		rows,
	}
	if (hasNewOrder) update.order = keys
	return update
}

/** The native list shows rows around `index`: the web renders around it too. */
export const steer = (index: number) => {
	const list = listElement()
	if (list === null) return
	let nearest: HTMLElement | undefined
	let distance = Number.POSITIVE_INFINITY
	let heights = 0
	const rows = Array.from(list.querySelectorAll<HTMLElement>(ROW))
	for (const row of rows) {
		const each = Math.abs(Number(row.getAttribute("data-index")) - index)
		heights += row.getBoundingClientRect().height
		if (each < distance) {
			distance = each
			nearest = row
		}
	}
	if (nearest === undefined) return
	// At the newest row: the list's end, where the web list follows new messages.
	if (index >= Number(list.getAttribute("data-list-count") ?? "0") - 1) list.scrollTop = list.scrollHeight
	else {
		const average = heights / rows.length
		const offset = px(nearest.style.top) + (index - Number(nearest.getAttribute("data-index"))) * average
		list.scrollTop = Math.max(0, offset - list.clientHeight / 2)
	}
	// The list pages (older at its start, newer at its end) on its scroll event, which a scroll to
	// where it already is never fires: tell it it is there.
	list.dispatchEvent(new Event("scroll"))
}

/** A tap on a row's link or button. */
export const pressHit = (id: string) => {
	const element = elements.get(id)?.deref()
	if (element instanceof HTMLElement && element.isConnected) element.click()
}

/** A choice from a row's long-press menu, replayed as the `change` its island listens for. */
export const chooseRowMenu = (id: string, key: string) => {
	const element = elements.get(id)?.deref()
	if (element === undefined || !element.isConnected) return
	Object.assign(element, { value: key })
	element.dispatchEvent(new Event("change", { bubbles: true }))
}
