import { beforeAll, describe, expect, it } from "vitest"

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
		expect(resolve("m-(--gutter)").style.margin).toEqual([0, 0, 0, 0])
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
})
