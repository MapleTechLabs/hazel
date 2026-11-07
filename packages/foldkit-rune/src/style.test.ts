import { beforeAll, describe, expect, it } from "vitest"

import { specificity } from "./selector"
import { type ElementInput, type Scope, StyleResolver } from "./style"

let styles: StyleResolver

beforeAll(async () => {
	styles = await StyleResolver.load(new URL("../test/styles.css", import.meta.url).pathname)
})

const element = (classes: string, extra: Partial<ElementInput> = {}): ElementInput => ({
	classes: classes.split(/\s+/).filter((c) => c !== ""),
	attrs: {},
	hasDescendant: () => false,
	...extra,
})

const resolve = (
	classes: string,
	options: { scope?: Scope; dark?: boolean; extra?: Partial<ElementInput> } = {},
) => {
	const input = element(classes, options.extra)
	styles.ensure(input.classes)
	const dark = options.dark ?? false
	return styles.resolve(input, options.scope ?? styles.rootScope(dark), dark, 1280)
}

describe("StyleResolver", () => {
	it("resolves utilities to px and colours", () => {
		const { style } = resolve(
			"flex flex-col gap-2 px-4 py-1.5 w-full rounded-lg bg-bg text-sm font-semibold",
		)
		expect(style).toMatchObject({
			display: "flex",
			dir: "col",
			gapRow: 8,
			gapCol: 8,
			pad: [6, 16, 6, 16],
			w: "full",
			radius: [8, 8, 8, 8],
			bg: "#ffffffff",
			fontSize: 14,
			lineHeight: 20,
			fontWeight: 600,
		})
	})

	it("sends focus and press styles as the states the host draws", () => {
		const button = resolve(
			"bg-[#ffffff] outline-hidden focus-visible:ring-2 focus-visible:ring-[#3366ff] active:bg-[#ff0000]",
		)
		expect(button.style.bg).toBe("#ffffffff")
		expect(button.style.shadows).toBeUndefined()
		expect(button.style.focusRing).toEqual({ width: 2, offset: 0, color: "#3366ffff" })
		expect(button.style.pressBg).toBe("#ff0000ff")
		// `:focus` shows on pointer focus too.
		expect(
			resolve("focus:outline-2 focus:outline-[#3366ff] focus:outline-offset-1").style.focusWithinRing,
		).toEqual({ width: 2, offset: 1, color: "#3366ffff" })
		// A hidden outline and no focus style: the browser draws no ring.
		expect(resolve("outline-hidden").style.focusRing).toBe("none")
		expect(resolve("px-2").style.focusRing).toBeUndefined()
	})

	it("applies <html>'s inline custom properties over the stylesheet's", () => {
		styles.setRootProperties(new Map([["--bg", "#123456"]]))
		try {
			expect(resolve("bg-bg").style.bg).toBe("#123456ff")
			expect(styles.customProperty("--bg", false)).toBe("#123456")
		} finally {
			styles.setRootProperties(new Map())
		}
		expect(resolve("bg-bg").style.bg).toBe("#ffffffff")
	})

	it("sends transitions per channel the host animates", () => {
		expect(resolve("transition-colors duration-200 ease-out").style.transition).toEqual({
			colors: { duration: 0.2, delay: 0, ease: [0, 0, 0.2, 1] },
		})
		// Tailwind's `transition`: colours, opacity and transforms on its default 150 ms curve.
		const plain = { duration: 0.15, delay: 0, ease: [0.4, 0, 0.2, 1] }
		expect(resolve("transition").style.transition).toEqual({
			colors: plain,
			opacity: plain,
			transform: plain,
		})
		expect(resolve("transition-[width] duration-300 ease-linear delay-75").style.transition).toEqual({
			layout: { duration: 0.3, delay: 0.075, ease: [0, 0, 1, 1] },
		})
		expect(Object.keys(resolve("transition-all").style.transition ?? {}).sort()).toEqual([
			"colors",
			"layout",
			"opacity",
			"transform",
		])
		expect(resolve("transition-none").style.transition).toBeUndefined()
		expect(resolve("px-2").style.transition).toBeUndefined()
	})

	it("sends keyframe animations the host can loop or play on mount", () => {
		expect(resolve("animate-spin").style.animation).toEqual({ kind: "spin", period: 1 })
		// Tailwind's pulse: full opacity at the start and end, half at the middle.
		expect(resolve("animate-pulse").style.animation).toEqual({
			kind: "pulse",
			period: 2,
			delay: 0,
			from: 1,
			to: 0.5,
		})
		expect(resolve("animate-in fade-in slide-in-from-top-2 duration-200").style.animation).toEqual({
			kind: "enter",
			duration: 0.2,
			delay: 0,
			opacity: 0,
			x: 0,
			y: -8,
			scale: 1,
		})
		expect(resolve("animate-bounce").style.animation).toBeUndefined()
		expect(styles.unsupportedProps.has("animation: bounce")).toBe(true)
	})

	it("sends a width that is a share of the parent as a fraction", () => {
		expect(resolve("w-1/2").style.w).toEqual({ frac: 0.5 })
		expect(resolve("w-[37.5%]").style.w).toEqual({ frac: 0.375 })
		// A share plus a length is not a fraction; a fraction of the height has no host form.
		expect(resolve("w-[calc(100%-2rem)]").style.w).toBe("auto")
		expect(resolve("h-1/2").style.h).toBe("auto")
	})

	it("switches theme tokens in dark mode", () => {
		expect(resolve("bg-bg text-fg", { dark: true }).style).toMatchObject({
			bg: "#000000ff",
			color: "#eeeeeeff",
		})
		expect(styles.pageStyle(true)).toEqual({ bg: "#000000ff", color: "#eeeeeeff" })
	})

	it("scopes custom properties to an element and its descendants", () => {
		const parent = resolve("[--gutter:12px] p-(--gutter)")
		expect(parent.style.pad).toEqual([12, 12, 12, 12])
		const child = resolve("m-(--gutter)", { scope: parent.scope })
		expect(child.style.margin).toEqual([12, 12, 12, 12])
		expect(resolve("m-(--gutter)").style.margin).toBeUndefined()
	})

	it("applies data attribute variants against the element's attributes", () => {
		expect(resolve("data-[state=open]:bg-black").style.bg).toBeUndefined()
		expect(
			resolve("data-[state=open]:bg-black", { extra: { attrs: { "data-state": "open" } } }).style.bg,
		).toBe("#000000ff")
	})

	it("pushes child and descendant rules down the tree", () => {
		const parent = resolve("*:data-[slot=icon]:size-4 **:data-[slot=label]:font-bold")
		const icon = resolve("", { scope: parent.scope, extra: { attrs: { "data-slot": "icon" } } })
		expect(icon.style).toMatchObject({ w: 16, h: 16 })
		const grandchild = resolve("", { scope: icon.scope, extra: { attrs: { "data-slot": "label" } } })
		expect(grandchild.style.fontWeight).toBe(700)
		const notChild = resolve("", { scope: icon.scope, extra: { attrs: { "data-slot": "icon" } } })
		expect(notChild.style.w).toBeUndefined()
	})

	it("evaluates :has() against descendants", () => {
		const withIcon = resolve("has-[[data-slot=icon]]:gap-3", { extra: { hasDescendant: () => true } })
		expect(withIcon.style.gapRow).toBe(12)
		expect(resolve("has-[[data-slot=icon]]:gap-3").style.gapRow).toBeUndefined()
	})

	it("counts a hex escape and its closing space as part of the class", () => {
		// `.\\32 xl\\:p-2` is one class: not a class, a space and a tag.
		expect(specificity(".\\32 xl\\:p-2")).toBe(specificity(".a"))
	})

	it("matches a class whose selector escapes a leading digit", () => {
		// Tailwind writes `2xl:p-2` as `.\\32 xl\\:p-2`: a hex escape, then a space that ends it.
		const input = element("2xl:p-2")
		styles.ensure(input.classes)
		expect(styles.resolve(input, styles.rootScope(false), false, 1600).style.pad).toEqual([8, 8, 8, 8])
		expect(styles.resolve(input, styles.rootScope(false), false, 1280).style.pad).toBeUndefined()
	})

	it("resolves viewport units against the window", () => {
		styles.setViewport(1000, 600)
		expect(resolve("h-dvh min-h-svh").style).toMatchObject({ h: 600, minH: 600 })
	})

	it("applies insets only to positioned elements", () => {
		expect(resolve("sticky top-0").style.absolute).toBeUndefined()
		expect(resolve("absolute inset-y-0 left-0").style.absolute).toEqual([0, 0, null, 0])
	})

	it("hides screen-reader-only text and reads inline styles last", () => {
		expect(resolve("sr-only").style.display).toBe("none")
		expect(
			resolve("p-2", { extra: { inline: { padding: "5px", "--x": "3px", margin: "var(--x)" } } }).style,
		).toMatchObject({ pad: [5, 5, 5, 5], margin: [3, 3, 3, 3] })
	})

	it("keeps hover colours apart from the base style", () => {
		const { style } = resolve("bg-white hover:bg-black")
		expect(style).toMatchObject({ bg: "#ffffffff", hoverBg: "#000000ff" })
	})

	it("answers the page root's custom properties for the theme", () => {
		expect(styles.customProperty("--bg", false)).toBe("#ffffff")
		expect(styles.customProperty("--bg", true)).toBe("#000000")
		expect(styles.customProperty("--missing", false)).toBe("")
	})

	it("expands one to four value shorthands into sides and corners", () => {
		const inline = {
			padding: "5px 10px",
			margin: "1px 2px 3px",
			gap: "4px 8px",
			"border-radius": "1px 2px 3px 4px",
		}
		expect(resolve("", { extra: { inline } }).style).toMatchObject({
			pad: [5, 10, 5, 10],
			margin: [1, 2, 3, 2],
			gapRow: 4,
			gapCol: 8,
			radius: [1, 2, 3, 4],
		})
	})

	it("decides positioning after inline styles", () => {
		const unpositioned = resolve("absolute top-0", { extra: { inline: { position: "static" } } }).style
		expect(unpositioned.absolute).toBeUndefined()
		expect(resolve("", { extra: { inline: { top: "10px" } } }).style.absolute).toBeUndefined()
		expect(
			resolve("", { extra: { inline: { position: "absolute", top: "10px" } } }).style.absolute,
		).toEqual([null, 10, null, null])
		expect(resolve("sticky top-0").style.absolute).toBeUndefined()
	})

	it("holds a sticky element at its top inset and leaves other positions in flow", () => {
		expect(resolve("sticky top-2").style.stickyTop).toBe(8)
		expect(resolve("sticky").style.stickyTop).toBeUndefined()
		expect(resolve("relative top-2").style.stickyTop).toBeUndefined()
	})

	it("reads flex keywords before numbers", () => {
		expect(resolve("flex-none").style).toMatchObject({ grow: 0, shrink: 0 })
		expect(resolve("flex-auto").style).toMatchObject({ grow: 1, shrink: 1 })
		expect(resolve("flex-initial").style).toMatchObject({ grow: 0, shrink: 1 })
		expect(resolve("flex-1").style).toMatchObject({ grow: 1, shrink: 1 })
	})

	it("honours max-width breakpoints and reports media it cannot answer", () => {
		styles.ensure(["max-md:hidden"])
		styles.setViewport(700, 600)
		expect(
			styles.resolve(element("max-md:hidden"), styles.rootScope(false), false, 700).style.display,
		).toBe("none")
		styles.setViewport(1280, 800)
		expect(resolve("max-md:hidden").style.display).toBeUndefined()
		resolve("[@media(orientation:portrait)]:p-2")
		expect([...styles.unsupportedSelectors.keys()]).toContain("@media (orientation:portrait)")
	})

	it("keeps percentages it cannot place out of the style instead of zeroing them", () => {
		expect(resolve("min-w-full").style.minW).toBe("full")
		expect(resolve("text-sm leading-[150%]").style.lineHeight).toBeCloseTo(21)
		expect(resolve("min-w-1/2").style.minW).toBeUndefined()
		expect([...styles.unsupportedProps.keys()].some((k) => k.startsWith("min-width:"))).toBe(true)
	})

	it("resolves container units against the nearest sized container, or leaves them out", () => {
		styles.setViewport(1280, 800)
		const avatar = resolve("size-8")
		const box = resolve("size-full [container-type:size]", { scope: avatar.scope })
		const letter = resolve("leading-none", {
			scope: box.scope,
			extra: { inline: { "font-size": "46cqw" } },
		})
		expect(letter.style.fontSize).toBeCloseTo(14.72)
		expect(letter.style.lineHeight).toBeCloseTo(14.72)
		expect(resolve("", { extra: { inline: { "font-size": "46cqw" } } }).style.fontSize).toBeUndefined()
	})

	it("composes rings and shadows into one list in paint order, without leaking them to children", () => {
		const parent = resolve("shadow-sm ring-2 ring-black")
		expect(parent.style.shadows).toEqual([
			{ x: 0, y: 1, blur: 2, spread: -1, color: "#0000001a", inset: false },
			{ x: 0, y: 1, blur: 3, spread: 0, color: "#0000001a", inset: false },
			{ x: 0, y: 0, blur: 0, spread: 2, color: "#000000ff", inset: false },
		])
		expect(resolve("", { scope: parent.scope }).style.shadows).toBeUndefined()
	})

	it("marks auto margins and reads currentColor from the element's own colour", () => {
		expect(resolve("ml-auto").style).toMatchObject({ marginAuto: [false, false, false, true] })
		expect(resolve("text-black border border-current").style.borderColor).toBe("#000000ff")
	})

	it("matches group and structural variants against ancestors and siblings", () => {
		// A commit compiles every class it shows before resolving any of them.
		styles.ensure(["group", "group-data-[open=true]:font-bold"])
		const group = resolve("group", { extra: { attrs: { "data-open": "true" } } })
		expect(resolve("group-data-[open=true]:font-bold", { scope: group.scope }).style.fontWeight).toBe(700)
		expect(resolve("group-data-[open=true]:font-bold").style.fontWeight).toBeUndefined()
		const at = (index: number) => ({ extra: { index, count: 3 } })
		expect(resolve("first:pt-1 last:pb-1", at(0)).style.pad).toEqual([4, 0, 0, 0])
		expect(resolve("first:pt-1 last:pb-1", at(2)).style.pad).toEqual([0, 0, 4, 0])
		expect(resolve("odd:opacity-50", at(1)).style.opacity).toBeUndefined()
	})
})
