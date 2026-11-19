/**
 * How the web draws a semantic node, read from the page: its box, colours, text styles and the
 * places of its parts. The native renderer draws its own views with these values, so a converted
 * screen looks like the web's (the same tokens, theme preset, light or dark) from the one view.
 *
 * Lengths are CSS pixels (points). Boxes are relative to the content they scroll in (or, for a
 * pinned node, its band), parts' positions relative to their node's box.
 */
export type Text = { color: string; size: number; weight: number; lineHeight: number; tracking: number }
export type Box = { x: number; y: number; w: number; h: number }

export type Look = {
	box: Box
	bg?: string
	radius?: number
	border?: { color: string; width: number }
	/** The wash the web shows under a pressed row. */
	pressedBg?: string
	label?: Text & { x: number; y: number }
	subtitle?: Text
	icon?: { x: number; size: number; color: string; radius: number; image?: string; avatar?: AvatarLook }
	/** A section header's glyph: how far down its box it sits. */
	iconY?: number
	trailing?: { right: number; size: number; color: string; image?: string }
	/** A thread row's line to its channel (`data-slot="thread-branch"`): it hangs outside the row's box. */
	branch?: Box & { image: string }
	badge?: Text & { bg: string; right: number; h: number; minW: number; radius: number; padX: number }
	/** A pinned node's band (the header or footer it sits in). */
	band?: { box: Box; bg: string; borderTop?: string; borderBottom?: string }
}

const colors = new Map<string, string>()
let context: CanvasRenderingContext2D | null = null

/** Any CSS colour (oklch, color-mix, …) as `#rrggbbaa`, as the browser resolves it. */
export const hex = (css: string): string => {
	const cached = colors.get(css)
	if (cached !== undefined) return cached
	context ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })
	if (context === null) return "#00000000"
	context.clearRect(0, 0, 1, 1)
	context.fillStyle = "#000000"
	context.fillStyle = css
	context.fillRect(0, 0, 1, 1)
	const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data
	// The canvas premultiplies nothing on read for an opaque fill; a translucent one is read back
	// un-premultiplied by `getImageData`, which is what a native colour wants.
	const value = `#${[r, g, b, a].map((n) => n.toString(16).padStart(2, "0")).join("")}`
	colors.set(css, value)
	return value
}

const isVisibleColor = (css: string) => hex(css).slice(7) !== "00"

const px = (value: string) => Number.parseFloat(value) || 0

const textOf = (element: Element): Text => {
	const style = getComputedStyle(element)
	const size = px(style.fontSize)
	return {
		color: hex(style.color),
		size,
		weight: Number(style.fontWeight) || 400,
		lineHeight: style.lineHeight === "normal" ? size * 1.2 : px(style.lineHeight),
		tracking: style.letterSpacing === "normal" ? 0 : px(style.letterSpacing),
	}
}

/** The nearest scroll container around `element`, whose content its box is measured in. */
const scrollerOf = (element: Element): Element | null => {
	for (let at = element.parentElement; at !== null; at = at.parentElement) {
		const overflow = getComputedStyle(at).overflowY
		if (overflow === "auto" || overflow === "scroll") return at
	}
	return null
}

/** `element`'s box in the content of `origin` (its scroll position added). */
const boxIn = (element: Element, origin: Element): Box => {
	const rect = element.getBoundingClientRect()
	const base = origin.getBoundingClientRect()
	return {
		x: rect.left - base.left,
		y: rect.top - base.top + origin.scrollTop,
		w: rect.width,
		h: rect.height,
	}
}

/**
 * The element in `root` that shows `text`: the one whose own text is all of it, else the one
 * that starts it (a sentence broken by a `<kbd>`). An avatar's initial ("H" of "Hazel") is too
 * short to count as a start.
 */
const elementWithText = (root: Element, text: string): Element | null => {
	if (text.length === 0) return null
	const texts: Array<Text_> = []
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const value = node.textContent?.trim() ?? ""
		if (value.length > 0 && node.parentElement !== null)
			texts.push({ value, element: node.parentElement })
	}
	return (
		texts.find(({ value }) => value === text)?.element ??
		texts.find(({ value }) => value.length >= 3 && text.startsWith(value))?.element ??
		null
	)
}
type Text_ = { value: string; element: Element }

/** Where `text`'s own glyphs are (its wrapper may also hold an avatar before them). */
const textRect = (root: Element, text: string): DOMRect | null => {
	if (text.length === 0) return null
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
	const nodes: Array<Node> = []
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node)
	const node =
		nodes.find((each) => each.textContent?.trim() === text) ??
		nodes.find((each) => {
			const value = each.textContent?.trim() ?? ""
			return value.length >= 3 && text.startsWith(value)
		})
	if (node === undefined) return null
	const range = document.createRange()
	range.selectNodeContents(node)
	return range.getBoundingClientRect()
}

let washProbe: HTMLElement | null = null
/** The theme's `wash` (the web's hover and pressed fill). */
const wash = (): string => {
	if (washProbe === null) {
		washProbe = document.createElement("div")
		washProbe.style.cssText = "position:absolute;width:0;height:0;visibility:hidden"
		document.body.appendChild(washProbe)
	}
	washProbe.style.backgroundColor = "var(--color-wash)"
	return hex(getComputedStyle(washProbe).backgroundColor)
}

/** The child of `screen` that holds `element`: a pinned node's band. */
const bandOf = (element: Element, screen: Element): Element | null => {
	for (let at: Element | null = element; at !== null; at = at.parentElement) {
		if (at.parentElement === screen) return at
	}
	return null
}

const borderColor = (style: CSSStyleDeclaration, side: "Top" | "Bottom") =>
	px(style[`border${side}Width`]) > 0 ? hex(style[`border${side}Color`]) : undefined

export const lookOf = (
	kind: string,
	element: Element,
	props: Record<string, unknown>,
	screen: Element,
): Look => {
	const pinned = props.pin === "top" || props.pin === "bottom"
	const band = pinned ? bandOf(element, screen) : null
	const origin = band ?? scrollerOf(element) ?? screen
	if (kind === "screen") {
		return { box: boxIn(element, element), bg: hex(getComputedStyle(element).backgroundColor) }
	}
	if (kind === "section") {
		const look: Look = { box: boxIn(element, origin) }
		const label = elementWithText(element, String(props.title ?? ""))
		if (label !== null) look.label = { ...textOf(label), ...placeOf(element, label, String(props.title)) }
		// The header's own glyph before the title (a collapse chevron).
		const glyph = label?.closest("button")?.querySelector("svg")
		if (glyph !== null && glyph !== undefined) {
			const at = element.getBoundingClientRect()
			const rect = glyph.getBoundingClientRect()
			look.icon = {
				x: rect.left - at.left,
				size: rect.width,
				color: hex(getComputedStyle(glyph).color),
				radius: 0,
				...imageOf(glyph),
			}
			look.iconY = rect.top - at.top
		}
		return look
	}
	if (kind === "action") {
		const icon = element.querySelector("svg") ?? element
		const style = getComputedStyle(icon)
		return {
			box: boxIn(element, origin),
			icon: {
				x: 0,
				size: icon.getBoundingClientRect().width,
				color: hex(style.color),
				radius: 0,
				...imageOf(icon),
			},
		}
	}
	// An item: its row is its link when it has one (what draws the selection), else itself.
	const row = element.querySelector("a[href]") ?? element
	const rowRect = row.getBoundingClientRect()
	const rowStyle = getComputedStyle(row)
	const ownStyle = getComputedStyle(element)
	const look: Look = {
		box: boxIn(row, origin),
		radius: px(rowStyle.borderTopLeftRadius) || px(ownStyle.borderTopLeftRadius),
		pressedBg: wash(),
	}
	if (isVisibleColor(rowStyle.backgroundColor)) look.bg = hex(rowStyle.backgroundColor)
	else if (isVisibleColor(ownStyle.backgroundColor)) look.bg = hex(ownStyle.backgroundColor)
	const borderWidth = px(rowStyle.borderTopWidth)
	if (borderWidth > 0) look.border = { color: hex(rowStyle.borderTopColor), width: borderWidth }

	const label = elementWithText(row, String(props.title ?? ""))
	if (label !== null) look.label = { ...textOf(label), ...placeOf(row, label, String(props.title)) }
	const subtitle = typeof props.subtitle === "string" ? elementWithText(row, props.subtitle) : null
	if (subtitle !== null) look.subtitle = textOf(subtitle)

	const icon =
		row.querySelector('[data-slot="avatar"]') ??
		row.querySelector('[data-slot="icon"]') ??
		row.querySelector('svg:not([data-slot="thread-branch"])')
	if (icon !== null) {
		const style = getComputedStyle(icon)
		look.icon = {
			x: icon.getBoundingClientRect().left - rowRect.left,
			size: icon.getBoundingClientRect().width,
			color: hex(style.color),
			radius: px(style.borderTopLeftRadius),
		}
		if (icon.getAttribute("data-slot") === "avatar") look.icon.avatar = avatarLookOf(icon)
		else {
			const key = iconKey(icon)
			if (key !== undefined) look.icon.image = key
		}
	}
	const branch = row.querySelector('svg[data-slot="thread-branch"]')
	const branchImage = branch === null ? undefined : iconKey(branch)
	if (branch !== null && branchImage !== undefined) {
		const rect = branch.getBoundingClientRect()
		look.branch = {
			x: rect.left - rowRect.left,
			y: rect.top - rowRect.top,
			w: rect.width,
			h: rect.height,
			image: branchImage,
		}
	}
	const trailing =
		props.trailingSymbol === undefined ? undefined : Array.from(element.querySelectorAll("svg")).at(-1)
	if (trailing !== undefined && trailing !== icon) {
		look.trailing = {
			right: rowRect.right - trailing.getBoundingClientRect().right,
			size: trailing.getBoundingClientRect().width,
			color: hex(getComputedStyle(trailing).color),
			...imageOf(trailing),
		}
	}
	const badge =
		element.querySelector('[data-slot="sidebar-badge"]') ??
		(props.badge === undefined ? null : elementWithText(element, String(props.badge)))
	if (badge !== null) {
		const style = getComputedStyle(badge)
		const rect = badge.getBoundingClientRect()
		look.badge = {
			...textOf(badge),
			bg: hex(style.backgroundColor),
			right: rowRect.right - rect.right,
			h: rect.height,
			minW: px(style.minWidth),
			radius: px(style.borderTopLeftRadius),
			padX: px(style.paddingLeft),
		}
	}
	if (band !== null) {
		const style = getComputedStyle(band)
		look.band = {
			box: boxIn(band, screen),
			bg: hex(style.backgroundColor),
			borderTop: borderColor(style, "Top"),
			borderBottom: borderColor(style, "Bottom"),
		}
	}
	return look
}

/** `{ image }` for an SVG the page has rasterized, else nothing (not yet, or not an SVG). */
const imageOf = (svg: Element): { image?: string } => {
	const key = iconKey(svg)
	return key === undefined ? {} : { image: key }
}

/** Where `text` sits in `box`: its own glyphs when they can be found, else its element. */
const placeOf = (box: Element, element: Element, text: string) => {
	const at = box.getBoundingClientRect()
	const glyphs = textRect(box, text) ?? element.getBoundingClientRect()
	return { x: glyphs.left - at.left, y: glyphs.top - at.top }
}

/** An unconverted element: where it is and how its text looks, so it can stand in its place. */
export const plainLookOf = (element: Element, screen: Element): Look => ({
	box: boxIn(element, scrollerOf(element) ?? screen),
	label: { ...textOf(element), x: 0, y: 0 },
})

// ICONS: the page's own SVGs, rasterized here so the native views show the same drawing.

/** Rasterized icons by key (a hash of the SVG as drawn: its markup, colour and size). */
const rasters = new Map<string, string>()
const rendering = new Map<string, Promise<void>>()
/** Keys rasterized since the shell was last sent icons. */
let unsent: Array<string> = []
let onRasterized: () => void = () => {}

/** Called when an icon finishes rasterizing: the tree that names it can be sent again. */
export const whenIconsRasterize = (callback: () => void) => {
	onRasterized = callback
}

/** The icons the shell has not been sent yet, as PNG data URLs by key. */
export const takeNewIcons = (): Record<string, string> => {
	const out: Record<string, string> = {}
	for (const key of unsent) out[key] = rasters.get(key) ?? ""
	unsent = []
	return out
}

/** Every icon still rasterizing, for the first native frame to wait on. */
export const iconsRendering = (): Promise<void> => Promise.all(rendering.values()).then(() => undefined)

const hash = (text: string): string => {
	let value = 5381
	for (let index = 0; index < text.length; index++)
		value = ((value << 5) + value + text.charCodeAt(index)) | 0
	return `i${(value >>> 0).toString(36)}${text.length.toString(36)}`
}

/** Device pixels per point the icons are drawn at. */
const SCALE = 3

/**
 * The key of `svg` as the page draws it: its `currentColor` resolved, at its rendered size. Drawing
 * starts if it was not drawn before; the picture follows under this key (`takeNewIcons`), and what
 * shows it draws again then.
 */
export const iconKey = (svg: Element): string | undefined => {
	if (!(svg instanceof SVGSVGElement)) return undefined
	const rect = svg.getBoundingClientRect()
	if (rect.width === 0 || rect.height === 0) return undefined
	const clone = svg.cloneNode(true)
	if (!(clone instanceof SVGSVGElement)) return undefined
	clone.removeAttribute("class")
	clone.setAttribute("width", String(rect.width))
	clone.setAttribute("height", String(rect.height))
	clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
	clone.setAttribute("style", `color: ${getComputedStyle(svg).color}`)
	const markup = new XMLSerializer().serializeToString(clone)
	const key = hash(markup)
	if (rasters.has(key)) return key
	if (!rendering.has(key)) {
		rendering.set(
			key,
			rasterize(markup, rect.width, rect.height)
				.then((url) => {
					rasters.set(key, url)
					unsent.push(key)
					onRasterized()
				})
				.catch(() => {})
				.finally(() => rendering.delete(key)),
		)
	}
	return key
}

/** The key of an icon given as markup (a menu item's, `iconOf`), drawn black at `size`: a template. */
const markupIconKey = (markup: string, size = 18): string => {
	const sized = markup.replace(/^<svg\b/, `<svg style="color: #000"`)
	const key = hash(`${size}:${sized}`)
	if (!rasters.has(key) && !rendering.has(key)) {
		const svg = new DOMParser().parseFromString(sized, "image/svg+xml").documentElement
		svg.setAttribute("width", String(size))
		svg.setAttribute("height", String(size))
		const drawn = new XMLSerializer().serializeToString(svg)
		rendering.set(
			key,
			rasterize(drawn, size, size)
				.then((url) => {
					rasters.set(key, url)
					unsent.push(key)
					onRasterized()
				})
				.catch(() => {})
				.finally(() => rendering.delete(key)),
		)
	}
	return key
}

/**
 * A native menu's items (`NativeMenuItem`), their icons rasterized: each item's SVG `icon` becomes
 * `image`, the key of its picture (`takeNewIcons`), so the shell shows the web's own icon.
 */
export type Json = string | number | boolean | null | Array<Json> | { [name: string]: Json }

export const withMenuIcons = (props: Json): Json => {
	if (Array.isArray(props)) return props.map(withMenuIcons)
	if (typeof props !== "object" || props === null) return props
	const out: { [name: string]: Json } = {}
	for (const [name, value] of Object.entries(props)) {
		if (name === "icon" && typeof value === "string") out.image = markupIconKey(value)
		else out[name] = withMenuIcons(value)
	}
	return out
}

const rasterize = async (markup: string, width: number, height: number): Promise<string> => {
	const image = new Image()
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
	await image.decode()
	const canvas = document.createElement("canvas")
	canvas.width = Math.ceil(width * SCALE)
	canvas.height = Math.ceil(height * SCALE)
	canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height)
	return canvas.toDataURL("image/png")
}

/** An avatar as the web draws it: a picture, or the dithered fill (colour, pattern, initial). */
export type AvatarLook = {
	src?: string
	bg?: string
	pattern?: string
	initial?: Text & { char: string }
}

export const avatarLookOf = (avatar: Element): AvatarLook => {
	const look: AvatarLook = {}
	const image = avatar.querySelector("img[data-avatar-img]")
	// Loaded or not: the shell loads pictures itself (`ImageLoader.swift`).
	if (image instanceof HTMLImageElement && (image.currentSrc || image.src) !== "")
		look.src = image.currentSrc || image.src
	const dither = avatar.querySelector("[data-dither-avatar]")
	if (dither !== null) {
		look.bg = hex(getComputedStyle(dither).backgroundColor)
		const pattern = dither.querySelector("svg")
		const key = pattern === null ? undefined : iconKey(pattern)
		if (key !== undefined) look.pattern = key
		const letter = dither.querySelector("span")
		const char = letter?.textContent?.trim() ?? ""
		if (letter !== null && char.length > 0) look.initial = { ...textOf(letter), char }
	}
	return look
}
