/**
 * Browser-golden conformance: every element Chromium rendered (conformance/fixtures, written by
 * conformance/extract.ts) is resolved again here with StyleResolver, and the resolved `Style` must
 * equal what the browser computed, through the one mapping in `expectations` below.
 */
import { readFileSync, readdirSync } from "node:fs"
import { beforeAll, describe, expect, it } from "vitest"

import { type ElementInput, type NodeInfo, type Scope, type Style, StyleResolver, color } from "./style"

type RecordedElement = {
	p: number
	prev: number
	tag: string
	cls: Array<string>
	attrs: Record<string, string>
	style?: string
	/** 1 when the element has a text node child (it is not `:empty`). */
	text?: 1
	cs: Record<string, string>
}
type Fixture = {
	name: string
	dark: boolean
	viewport: [number, number]
	html: { cls: string; style: string }
	defaults: Record<string, string>
	elements: Array<RecordedElement>
}

const fixturesDir = new URL("../conformance/fixtures/", import.meta.url)
/** JSON Lines: the header, then one element per line (conformance/extract.ts `write`). */
const readFixture = (file: string): Fixture => {
	const [header = "{}", ...lines] = readFileSync(new URL(file, fixturesDir), "utf8").trimEnd().split("\n")
	const text = `{"elements":[${lines.join(",")}],${header.slice(1)}`
	// SAFETY: conformance/extract.ts writes exactly the Fixture shape, split into lines.
	return JSON.parse(text) as Fixture
}
const fixtures = readdirSync(fixturesDir)
	.filter((file) => file.endsWith(".jsonl"))
	.sort()
	.map(readFixture)

/** `style="a: b; c: d"` as a record, the way target.ts reads an inline style attribute. */
const parseInline = (text: string | undefined): Record<string, string> | undefined => {
	if (text === undefined) return undefined
	const out: Record<string, string> = {}
	for (const declaration of text.split(";")) {
		const colon = declaration.indexOf(":")
		if (colon > 0) out[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim()
	}
	return out
}

/**
 * What the host inherits from an ancestor when an element's Style leaves a text property unset,
 * mirroring `Inherit::from` in apps/native/host/src/layout.rs (CSS inheritance for the rest).
 */
type Inherited = {
	color: string
	size: number
	line: number
	weight: number
	family: string
	italic: boolean
	letterSpacing: number
	textTransform: string
	whiteSpacePre: boolean
	nowrap: boolean
	visibility: string
	textAlign: string
}

const inherit = (parent: Inherited, st: Style): Inherited => {
	const size = st.fontSize ?? parent.size
	return {
		color: st.color ?? parent.color,
		size,
		line: st.lineHeight ?? (st.fontSize !== undefined ? size * 1.4 : parent.line),
		weight: st.fontWeight ?? parent.weight,
		family: st.fontFamily ?? parent.family,
		italic: st.italic ?? parent.italic,
		letterSpacing: st.letterSpacing ?? parent.letterSpacing,
		textTransform: st.textTransform ?? parent.textTransform,
		whiteSpacePre: st.whiteSpacePre ?? parent.whiteSpacePre,
		nowrap: st.nowrap ?? parent.nowrap,
		visibility: st.visibility ?? parent.visibility,
		textAlign: st.textAlign ?? parent.textAlign,
	}
}

/** Tags the host lays out inline when their Style has no display (main.rs `is_inline`). */
const INLINE_TAGS = new Set([
	"span",
	"a",
	"kbd",
	"label",
	"button",
	"strong",
	"em",
	"code",
	"time",
	"b",
	"i",
	"s",
	"u",
	"mark",
])

const px = (v: string | undefined): number | null => {
	if (v === undefined) return null
	const m = /^(-?[\d.e+-]+)px$/.exec(v.trim())
	return m ? Number(m[1]) : null
}

const near = (a: number, b: number, tolerance = 0.5) =>
	Math.abs(a - b) <= tolerance || (Math.abs(a) >= 9999 && Math.abs(b) >= 9999)

/** `#rrggbbaa` channels; fully transparent colours are all equal. */
const sameColor = (a: string | null, b: string | null) => {
	if (a === null || b === null) return a === b
	const ch = (c: string) => [1, 3, 5, 7].map((i) => parseInt(c.slice(i, i + 2), 16))
	const [x, y] = [ch(a), ch(b)]
	if (x[3] === 0 && y[3] === 0) return true
	return x.every((v, i) => Math.abs(v - (y[i] ?? 0)) <= 1)
}

type Shadow = NonNullable<Style["shadows"]>[number]

/** A computed `box-shadow` list (`rgba(..) 0px 1px 2px 0px inset, ...`), invisible ones dropped. */
const parseShadows = (v: string): Array<Shadow> => {
	if (v === "none") return []
	const out: Array<Shadow> = []
	for (const part of splitTop(v)) {
		const colorMatch = /^((?:[a-z-]+\([^)]*\))|#[0-9a-f]+|transparent)/i.exec(part.trim())
		const colorText = colorMatch?.[1] ?? "transparent"
		const rest = part.trim().slice(colorText.length).trim()
		const inset = /\binset\b/.test(rest)
		const nums = rest
			.replace("inset", "")
			.trim()
			.split(/\s+/)
			.map((n) => px(n) ?? 0)
		const c = color(colorText) ?? "#00000000"
		if (c.endsWith("00")) continue
		out.push({
			x: nums[0] ?? 0,
			y: nums[1] ?? 0,
			blur: nums[2] ?? 0,
			spread: nums[3] ?? 0,
			color: c,
			inset,
		})
	}
	// CSS lists the top-most shadow first; Style lists them in paint order.
	return out.reverse()
}

/** Splits on commas outside parentheses. */
const splitTop = (v: string): Array<string> => {
	const out: Array<string> = []
	let depth = 0
	let start = 0
	for (let i = 0; i < v.length; i++) {
		if (v[i] === "(") depth++
		else if (v[i] === ")") depth--
		else if (v[i] === "," && depth === 0) {
			out.push(v.slice(start, i))
			start = i + 1
		}
	}
	out.push(v.slice(start))
	return out.map((s) => s.trim()).filter((s) => s !== "")
}

type BgImage = NonNullable<Style["bgImage"]>

const SIDE_ANGLES = new Map([
	["top", 0],
	["right", 90],
	["bottom", 180],
	["left", 270],
	["top right", 45],
	["right top", 45],
	["bottom right", 135],
	["right bottom", 135],
	["bottom left", 225],
	["left bottom", 225],
	["top left", 315],
	["left top", 315],
])

/** A computed `background-image`: `url("…")` or one `linear-gradient(…)`. */
const parseBgImage = (v: string): BgImage | "other" | undefined => {
	if (v === "none") return undefined
	const url = /^url\("?([^")]*)"?\)$/.exec(v)
	if (url) return { url: url[1] ?? "" }
	const lin = /^linear-gradient\((.*)\)$/.exec(v)
	if (!lin) return "other"
	const parts = splitTop(lin[1] ?? "")
	let angle = 180
	const first = (parts[0] ?? "").replace(/\s+in\s+[a-z]+(\s+(shorter|longer)\s+hue)?$/, "").trim()
	const deg = /^(-?[\d.]+)deg$/.exec(first)
	if (deg) {
		angle = Number(deg[1])
		parts.shift()
	} else if (first.startsWith("to ")) {
		angle = SIDE_ANGLES.get(first.slice(3)) ?? 180
		parts.shift()
	} else if (/^in\s/.test(parts[0] ?? "")) parts.shift()
	const stops = parts.map((p) => {
		const m = /^(.*?)\s+(-?[\d.]+)%$/.exec(p)
		return { color: color(m ? (m[1] ?? "") : p) ?? "#00000000", at: m ? Number(m[2]) / 100 : Number.NaN }
	})
	stops.forEach((s, i) => {
		if (Number.isNaN(s.at)) s.at = stops.length === 1 ? 0 : i / (stops.length - 1)
	})
	return { gradient: { angle: ((angle % 360) + 360) % 360, stops } }
}

const sameBgImage = (a: BgImage | "other" | undefined, b: BgImage | undefined) => {
	if (a === undefined || b === undefined) return a === b
	if (a === "other") return false
	if ("url" in a) return "url" in b && new URL(b.url, PAGE).href === a.url
	if (!("gradient" in b)) return false
	const [x, y] = [a.gradient, b.gradient]
	return (
		near(x.angle, y.angle, 0.5) &&
		x.stops.length === y.stops.length &&
		x.stops.every(
			(s, i) => sameColor(s.color, y.stops[i]?.color ?? null) && near(s.at, y.stops[i]?.at ?? -1, 0.01),
		)
	)
}

const PAGE = "http://page.test/"

/** A typed-OM length to what `Px` can say: a px number, "full" for 100%, null for anything else. */
const typedLen = (v: string): number | "full" | "auto" | { frac: number } | "other" => {
	const n = px(v)
	if (n !== null) return n
	if (v === "100%") return "full"
	const share = /^([\d.]+)%$/.exec(v)
	if (share !== null) return { frac: Number(share[1]) / 100 }
	// Content-sized: what the host does for a box with no size.
	if (["auto", "none", "", "fit-content", "max-content", "min-content"].includes(v)) return "auto"
	return "other"
}

/** One comparable fact: the browser's value and the resolver's, already in the same form. */
type Check = { prop: string; browser: unknown; resolver: unknown; equal: boolean }

type Context = {
	el: RecordedElement
	cs: (prop: string) => string
	st: Style
	inh: Inherited
	parentStyle: Style | undefined
	parentDisplay: string
	isLastChild: boolean
}

const browserDisplay = (cs: Context["cs"]) => {
	const d = cs("display")
	if (cs("clip-path").replace(/\s/g, "") === "inset(50%)") return "none"
	if (d === "inline-block" || d === "inline") return "inline"
	if (["none", "contents", "flex", "inline-flex", "grid", "inline-grid"].includes(d)) return d
	return "block"
}

const resolverDisplay = (st: Style, tag: string) => {
	const d = st.display ?? (INLINE_TAGS.has(tag) ? "inline" : "block")
	if ((d === "flex" || d === "grid") && st.inline === true) return `inline-${d}`
	return d
}

/**
 * The mapping: for each Style field, the browser's computed value and the resolver's value in one
 * comparable form. "Unset" in Style means the CSS initial value, or the inherited one for text.
 */
const expectations = (ctx: Context): Array<Check> => {
	const { el, cs, st, inh } = ctx
	const checks: Array<Check> = []
	const add = (prop: string, browser: unknown, resolver: unknown, equal?: boolean) =>
		checks.push({
			prop,
			browser,
			resolver,
			equal: equal ?? JSON.stringify(browser) === JSON.stringify(resolver),
		})
	const num = (prop: string, browser: number | null, resolver: number, tolerance = 0.5) =>
		add(prop, browser, resolver, browser !== null && near(browser, resolver, tolerance))
	const display = browserDisplay(cs)
	add("display", display, resolverDisplay(st, el.tag))
	if (display === "none") return checks
	const flexLike = display.endsWith("flex")
	const container = flexLike || display.endsWith("grid")
	if (flexLike) {
		add("dir", cs("flex-direction").startsWith("column") ? "col" : "row", st.dir ?? "row")
		add("wrap", cs("flex-wrap") !== "nowrap", st.wrap ?? false)
	}
	if (container) {
		num("gapRow", cs("row-gap") === "normal" ? 0 : px(cs("row-gap")), st.gapRow ?? 0)
		num("gapCol", cs("column-gap") === "normal" ? 0 : px(cs("column-gap")), st.gapCol ?? 0)
		const items = cs("align-items")
		const normal = (v: string | undefined) =>
			v === undefined || v === "normal" || v === "stretch" ? "stretch" : v.replace(/^flex-/, "")
		add("items", normal(items), normal(st.items))
		const justify = (v: string | undefined) =>
			v === undefined || v === "normal" || v === "flex-start" || v === "start"
				? "start"
				: v.replace(/^flex-/, "")
		add("justify", justify(cs("justify-content")), justify(st.justify))
	}
	const self = (v: string | undefined) =>
		v === undefined || v === "auto" ? "auto" : v.replace(/^flex-/, "")
	add("self", self(cs("align-self")), self(st.self))
	const sides = ["top", "right", "bottom", "left"] as const
	sides.forEach((side, i) => num(`pad.${side}`, px(cs(`padding-${side}`)), st.pad?.[i] ?? 0))
	sides.forEach((side, i) => {
		const typed = cs(`@margin-${side}`)
		const auto = st.marginAuto?.[i] ?? false
		if (typed === "auto" || auto)
			return add(
				`margin.${side}`,
				typed === "auto" ? "auto" : typed,
				auto ? "auto" : (st.margin?.[i] ?? 0),
			)
		let browser = px(typed)
		// space-x / space-y: the parent's childGap is a margin on every child but the last.
		const gap = ctx.parentStyle?.childGap
		if (gap !== undefined && browser !== null && !ctx.isLastChild) {
			const row = ctx.parentDisplay.endsWith("flex") && ctx.parentStyle?.dir !== "col"
			if ((side === "right" && row) || (side === "bottom" && !row)) browser -= gap
		}
		num(`margin.${side}`, browser, st.margin?.[i] ?? 0)
	})
	const len = (prop: string, typedProp: string, value: Style["w"] | number | undefined, none: string) => {
		const browser = typedLen(cs(typedProp))
		const resolver = value === undefined || value === "auto" ? "auto" : value
		if (browser === "auto" && cs(typedProp) !== none && cs(typedProp) !== "auto") return
		if (typeof browser === "number" && typeof resolver === "number") return num(prop, browser, resolver)
		add(prop, browser === "other" ? cs(typedProp) : browser, resolver)
	}
	len("w", "@width", st.w, "auto")
	len("h", "@height", st.h, "auto")
	const minOf = (typedProp: string) => (cs(typedProp) === "0px" ? "auto" : cs(typedProp))
	const minLen = (prop: string, typedProp: string, value: number | "full" | undefined) => {
		const browser = typedLen(minOf(typedProp))
		const resolver = value === undefined || value === 0 ? "auto" : value
		if (typeof browser === "number" && typeof resolver === "number") return num(prop, browser, resolver)
		add(prop, browser === "other" ? cs(typedProp) : browser, resolver)
	}
	minLen("minW", "@min-width", st.minW)
	minLen("minH", "@min-height", st.minH)
	minLen("maxW", "@max-width", st.maxW)
	minLen("maxH", "@max-height", st.maxH)
	num("grow", Number(cs("flex-grow")), st.grow ?? 0, 0.01)
	num("shrink", Number(cs("flex-shrink")), st.shrink ?? 1, 0.01)
	const bg = color(cs("background-color"))
	add("bg", bg, st.bg ?? "#00000000", sameColor(bg, st.bg ?? "#00000000"))
	add(
		"bgImage",
		parseBgImage(cs("background-image")),
		st.bgImage,
		sameBgImage(parseBgImage(cs("background-image")), st.bgImage),
	)
	const fg = color(cs("color"))
	add("color", fg, inh.color, sameColor(fg, inh.color))
	sides.forEach((side, i) => {
		const width = px(cs(`border-${side}-width`)) ?? 0
		num(`border.${side}`, width, st.border?.[i] ?? 0)
		if (width > 0) {
			const c = color(cs(`border-${side}-color`))
			const resolved = st.borderColor ?? inh.color
			add(`borderColor`, c, resolved, sameColor(c, resolved))
		}
	})
	const corners = ["top-left", "top-right", "bottom-right", "bottom-left"]
	corners.forEach((corner, i) =>
		num(`radius.${corner}`, px(cs(`border-${corner}-radius`)), st.radius?.[i] ?? 0),
	)
	num("fontSize", px(cs("font-size")), inh.size)
	num("fontWeight", Number(cs("font-weight")), inh.weight, 0.5)
	if (cs("line-height") !== "normal") num("lineHeight", px(cs("line-height")), inh.line)
	num(
		"letterSpacing",
		cs("letter-spacing") === "normal" ? 0 : px(cs("letter-spacing")),
		inh.letterSpacing,
		0.05,
	)
	const family = /mono/i.test(cs("font-family").split(",")[0] ?? "") ? "mono" : "sans"
	add("fontFamily", family, inh.family)
	add("italic", cs("font-style") !== "normal", inh.italic)
	add("textTransform", cs("text-transform"), inh.textTransform)
	const deco = cs("text-decoration-line")
	add("textDecoration", deco === "none" ? undefined : deco, st.textDecoration)
	const ws = cs("white-space")
	add("whiteSpacePre", ws === "pre" || ws === "pre-wrap" || ws === "break-spaces", inh.whiteSpacePre)
	add("nowrap", ws === "nowrap" || ws === "pre", inh.nowrap)
	add("truncate", cs("text-overflow") === "ellipsis", st.truncate ?? false)
	// Left-to-right text: start is left, end is right.
	const align = (v: string) => (v === "start" ? "left" : v === "end" ? "right" : v.replace(/^-webkit-/, ""))
	add("textAlign", align(cs("text-align")), align(inh.textAlign))
	num("opacity", Number(cs("opacity")), st.opacity ?? 1, 0.01)
	const [ox, oy] = [cs("overflow-x"), cs("overflow-y")]
	add("scrollY", oy === "auto" || oy === "scroll", st.scrollY ?? false)
	add("clip", ["hidden", "clip"].includes(ox) || ["hidden", "clip"].includes(oy), st.clip ?? false)
	const position = cs("position")
	const outOfFlow = position === "absolute" || position === "fixed"
	add("absolute", outOfFlow, st.absolute !== undefined)
	if (outOfFlow && st.absolute !== undefined) {
		const order = ["left", "top", "right", "bottom"] as const
		order.forEach((side, i) => {
			const typed = cs(`@${side}`)
			if (side === "top" && typed === "50%")
				return add("absolute.top", "50%", st.centerY ? "50%" : st.absolute?.[1])
			// `inset-y-1/2` with centring: the bottom inset says nothing more.
			if (side === "bottom" && typed === "50%" && st.centerY === true) return
			const b = typedLen(typed)
			const r = st.absolute?.[i] ?? "auto"
			if (typeof b === "number" && typeof r === "number") return num(`absolute.${side}`, b, r)
			add(`absolute.${side}`, b === "other" ? typed : b, r)
		})
	}
	const z = cs("z-index")
	add("zIndex", z === "auto" ? undefined : Number(z), st.zIndex)
	add("visibility", cs("visibility") === "visible" ? "visible" : "hidden", inh.visibility)
	const fit = cs("object-fit")
	add("objectFit", fit === "fill" ? undefined : fit, st.objectFit)
	const ar = cs("aspect-ratio")
	const ratio = /^(?:auto\s+)?([\d.]+)\s*\/\s*([\d.]+)$/.exec(ar)
	add(
		"aspectRatio",
		ratio ? Number(ratio[1]) / Number(ratio[2]) : undefined,
		st.aspectRatio,
		ratio
			? st.aspectRatio !== undefined && near(Number(ratio[1]) / Number(ratio[2]), st.aspectRatio, 0.01)
			: st.aspectRatio === undefined,
	)
	const browserShadows = parseShadows(cs("box-shadow"))
	const shadows = st.shadows ?? []
	add(
		"shadows",
		browserShadows,
		shadows,
		browserShadows.length === shadows.length &&
			browserShadows.every((s, i) => {
				const r = shadows[i]
				return (
					r !== undefined &&
					s.inset === r.inset &&
					near(s.x, r.x) &&
					near(s.y, r.y) &&
					near(s.blur, r.blur) &&
					near(s.spread, r.spread) &&
					sameColor(s.color, r.color)
				)
			}),
	)
	const outlineColor = color(cs("outline-color"))
	const outlineWidth = px(cs("outline-width")) ?? 0
	// A zero-width or transparent outline paints nothing: Style leaves it out.
	if (
		cs("outline-style") !== "none" &&
		outlineWidth > 0 &&
		outlineColor !== null &&
		!outlineColor.endsWith("00")
	) {
		const o = { width: outlineWidth, color: outlineColor, offset: px(cs("outline-offset")) ?? 0 }
		const r = st.outline
		add(
			"outline",
			o,
			r,
			r !== undefined &&
				near(o.width, r.width) &&
				near(o.offset, r.offset) &&
				sameColor(o.color, r.color),
		)
	} else add("outline", undefined, st.outline)
	const translate = cs("translate")
	if (translate === "none") add("translate", undefined, st.translate)
	else {
		const parts = translate.split(/\s+/)
		const [x, y] = [px(parts[0]), parts[1] === undefined ? 0 : px(parts[1])]
		const centered = st.centerY === true && parts[1] === "-50%"
		if (centered) add("translate", "centerY", "centerY")
		else if (x === null || y === null) add("translate", translate, st.translate)
		else
			add(
				"translate",
				[x, y],
				st.translate ?? [0, 0],
				near(x, st.translate?.[0] ?? 0) && near(y, st.translate?.[1] ?? 0),
			)
	}
	return checks
}

/**
 * Known renderer gaps: a mismatch on `prop` for an element whose classes or tag match `when` is
 * reported but does not fail. Every entry says why the wire cannot express the browser's value.
 */
const ALLOWLIST: Array<{ prop: string; when: RegExp; reason: string }> = [
	{
		prop: "w",
		when: /\bw-\[calc\(100%-2rem\)\]/,
		reason: "Px is px, a share of the parent or auto: calc() mixing a share and a length has no wire form",
	},
	{
		prop: "absolute.left",
		when: /\bleft-1\/2\b/,
		reason: "insets are px: 50% of the containing block has no wire form (only vertical centring has centerY)",
	},
	{
		prop: "translate",
		when: /\s-translate-x-1\/2\b/,
		reason: "translate is px: a share of the element's own width has no wire form (only -50% Y under top-1/2, as centerY)",
	},
	{
		prop: "absolute.bottom",
		when: /\bbottom-full\b/,
		reason: "insets are px: bottom: 100% needs the containing block's height, known only at layout",
	},
]

type Mismatch = {
	fixture: string
	index: number
	prop: string
	browser: unknown
	resolver: unknown
	what: string
}

const runFixture = (styles: StyleResolver, fixture: Fixture) => {
	const dark = fixture.dark
	styles.setViewport(fixture.viewport[0], fixture.viewport[1])
	// `applyTheme` sets the brand and radius tokens inline on <html>: the same overrides, at the root.
	const root = styles.resolve(
		{ classes: [], attrs: {}, inline: parseInline(fixture.html.style), hasDescendant: () => false },
		styles.rootScope(dark),
		dark,
		fixture.viewport[0],
	)
	const pageColor = styles.pageStyle(dark).color ?? "#000000ff"
	const rootInherited: Inherited = {
		color: pageColor,
		size: 16,
		line: 24,
		weight: 400,
		family: "sans",
		italic: false,
		letterSpacing: 0,
		textTransform: "none",
		whiteSpacePre: false,
		nowrap: false,
		visibility: "visible",
		textAlign: "start",
	}
	const { elements } = fixture
	const children = elements.map((): Array<number> => [])
	const roots: Array<number> = []
	elements.forEach((el, i) => {
		if (el.p >= 0) children[el.p]?.push(i)
		else roots.push(i)
	})
	const descendants = (i: number): Array<number> =>
		(children[i] ?? []).flatMap((c) => [c, ...descendants(c)])
	const siblingsOf = (i: number) => {
		const p = elements[i]?.p ?? -1
		return p >= 0 ? (children[p] ?? []) : roots
	}
	const isEmpty = (i: number) => (children[i] ?? []).length === 0 && elements[i]?.text !== 1
	const info = (i: number): NodeInfo => {
		const node = elements[i]
		const siblings = siblingsOf(i)
		return {
			tag: node?.tag ?? "div",
			classes: node?.cls ?? [],
			attrs: node?.attrs ?? {},
			index: siblings.indexOf(i),
			count: siblings.length,
			empty: isEmpty(i),
		}
	}
	const out: Array<{ style: Style; scope: Scope; inh: Inherited }> = []
	const mismatches: Array<Mismatch> = []
	const counts = new Map<string, { checked: number; failed: number }>()
	elements.forEach((el, i) => {
		const parent = el.p >= 0 ? out[el.p] : undefined
		const scope = parent?.scope ?? root.scope
		const siblings = siblingsOf(i)
		const position = siblings.indexOf(i)
		const input: ElementInput = {
			tag: el.tag,
			classes: el.cls,
			attrs: el.attrs,
			inline: parseInline(el.style),
			prevSiblings: siblings.slice(0, position).reverse().map(info),
			index: position,
			count: siblings.length,
			empty: isEmpty(i),
			hasDescendant: (match, childrenOnly) =>
				(childrenOnly === true ? (children[i] ?? []) : descendants(i)).some((d) => match(info(d))),
		}
		const { style, scope: childScope } = styles.resolve(input, scope, dark, fixture.viewport[0])
		const inh = inherit(parent?.inh ?? rootInherited, style)
		out.push({ style, scope: childScope, inh })
		const cs = (prop: string) => el.cs[prop] ?? fixture.defaults[prop] ?? ""
		const parentRecord = el.p >= 0 ? elements[el.p] : undefined
		const checks = expectations({
			el,
			cs,
			st: style,
			inh,
			parentStyle: parent?.style,
			parentDisplay:
				parentRecord === undefined
					? "block"
					: browserDisplay((prop) => parentRecord.cs[prop] ?? fixture.defaults[prop] ?? ""),
			isLastChild: siblings.at(-1) === i,
		})
		for (const check of checks) {
			const count = counts.get(check.prop) ?? { checked: 0, failed: 0 }
			counts.set(check.prop, count)
			count.checked++
			if (!check.equal) {
				count.failed++
				mismatches.push({
					fixture: fixture.name,
					index: i,
					prop: check.prop,
					browser: check.browser,
					resolver: check.resolver,
					what: `<${el.tag}> ${el.cls.join(" ")}${el.style === undefined ? "" : ` style="${el.style}"`}`,
				})
			}
		}
	})
	return { mismatches, counts }
}

let styles: StyleResolver

beforeAll(async () => {
	styles = await StyleResolver.load(
		new URL("../../../apps/web-foldkit/src/styles.css", import.meta.url).pathname,
	)
	styles.ensure(fixtures.flatMap((f) => f.elements.flatMap((el) => el.cls)))
}, 60_000)

describe("conformance with Chromium", () => {
	it("has fixtures", () => {
		expect(fixtures.map((f) => f.name)).toEqual([
			"app-dark",
			"app-light",
			"synthetic-dark",
			"synthetic-light",
		])
	})

	it("resolves every recorded element to the browser's computed style", () => {
		const all: Array<Mismatch> = []
		const totals = new Map<string, { checked: number; failed: number }>()
		for (const fixture of fixtures) {
			const { mismatches, counts } = runFixture(styles, fixture)
			all.push(...mismatches)
			for (const [prop, c] of counts) {
				const t = totals.get(prop) ?? { checked: 0, failed: 0 }
				totals.set(prop, { checked: t.checked + c.checked, failed: t.failed + c.failed })
			}
		}
		const allowed = (m: Mismatch) => ALLOWLIST.some((a) => a.prop === m.prop && a.when.test(m.what))
		const failing = all.filter((m) => !allowed(m))
		const table = [...totals]
			.filter(([, c]) => c.failed > 0)
			.sort((a, b) => b[1].failed - a[1].failed)
			.map(([prop, c]) => {
				const open = failing.filter((m) => m.prop === prop).length
				return `${prop.padEnd(24)} ${String(c.failed).padStart(5)} / ${String(c.checked).padEnd(6)} unallowed ${open}`
			})
		const examples = failing
			.slice(0, Number(process.env.CONFORMANCE_EXAMPLES ?? 60))
			.map(
				(m) =>
					`${m.fixture}#${m.index} ${m.prop}: browser ${JSON.stringify(m.browser)} resolver ${JSON.stringify(m.resolver)}\n    ${m.what}`,
			)
		const allowedTable = ALLOWLIST.map(
			(a) =>
				`${a.prop}: ${all.filter((m) => m.prop === a.prop && a.when.test(m.what)).length} (${a.reason})`,
		)
		console.log(
			`per-property mismatches (failed / checked):\n${table.join("\n") || "(none)"}\n\nallowed:\n${allowedTable.join("\n")}\n\n${examples.join("\n")}`,
		)
		expect(failing.length).toBe(0)
	})
})
