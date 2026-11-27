/**
 * The list's end anchoring in Chromium (it needs real layout): a chat list that first mounts hidden,
 * as a channel switch mounts it in the shell's hidden home, lands at its end once it shows, raises no
 * `reachStart` meanwhile, and rows leaving the render band keep their height. Browser mode only.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import type { Plain, Primitive } from "../../define.ts"

const inBrowser = typeof navigator !== "undefined" && /Chrome|HeadlessChrome/.test(navigator.userAgent)

let List: typeof import("../list.ts")

beforeAll(async () => {
	if (inBrowser) List = await import("../list.ts")
})

afterEach(() => {
	if (inBrowser) document.body.replaceChildren()
})

const frames = (count = 3) =>
	new Promise<void>((resolve) => {
		const step = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)))
		step(count)
	})

/** A list of `count` padded rows in `parent`; `hidden` parents it like the shell's hidden home. */
const mount = (parent: HTMLElement, props: Readonly<Record<string, Plain>>) => {
	const made: Primitive = List.primitive.create({
		document,
		tag: "hz:list",
		outer: (tagName) => {
			const node = document.createElement(tagName)
			node.dataset.hz = "list"
			return node
		},
		self: (node, set) => ({ tag: "hz:list", outer: node, content: node, set, events: undefined }),
	})
	const fired: Array<string> = []
	made.events = {
		handlers: { reachStart: "reachStart", reachEnd: "reachEnd" },
		dispatch: (event) => {
			fired.push(event)
			return true
		},
	}
	for (const [name, value] of Object.entries(props)) made.set(name, value)
	parent.append(made.outer)
	const viewport = made.outer.querySelector<HTMLElement>("[data-hz-part=viewport]")!
	const addRows = (count: number) => {
		for (let index = 0; index < count; index++) {
			const row = document.createElement("div")
			row.dataset.hz = "message"
			// Padding and a border, which a skipped row's intrinsic size must not count twice.
			row.style.cssText = "padding-block: 4px; border-top: 1px solid"
			const body = document.createElement("div")
			body.style.height = "40px"
			body.textContent = `row ${index}`
			row.append(body)
			made.content.append(row)
		}
	}
	return { made, viewport, fired, addRows }
}

const pane = (hidden: boolean) => {
	const parent = document.createElement("div")
	// The shell's home is `hidden` (display: none); a hole is a sized flex column.
	parent.style.cssText = `display: ${hidden ? "none" : "flex"}; flex-direction: column; height: 400px; width: 400px`
	document.body.append(parent)
	return parent
}

const atEnd = (viewport: HTMLElement) =>
	viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 2

describe.runIf(inBrowser)("list anchoring in a real browser", () => {
	it("lands an end-anchored list at its end once a hidden mount shows, without paging older", async () => {
		const home = pane(true)
		const list = mount(home, { anchor: "end", stickToBottom: true, loading: true })
		await frames()
		list.made.set("loading", false)
		list.addRows(60)
		await frames()
		// Hidden: no box, so it waits instead of settling at the top.
		expect(list.fired).toEqual([])
		const hole = pane(false)
		hole.append(list.made.outer)
		await frames()
		expect(list.viewport.scrollTop).toBeGreaterThan(0)
		expect(atEnd(list.viewport)).toBe(true)
		expect(list.fired).not.toContain("reachStart")
	})

	it("keeps the end still while far rows leave the render band", async () => {
		const list = mount(pane(false), { anchor: "end", stickToBottom: true })
		list.addRows(80)
		await frames(2)
		const height = list.viewport.scrollHeight
		const lastTop = () => list.made.content.lastElementChild!.getBoundingClientRect().top
		const before = lastTop()
		// The band's observer marks the far rows offscreen over the next frames.
		await frames(6)
		expect(list.made.content.querySelector("[data-hz-offscreen]")).not.toBeNull()
		expect(list.viewport.scrollHeight).toBe(height)
		expect(lastTop()).toBe(before)
		expect(atEnd(list.viewport)).toBe(true)
	})

	it("lands a list that mounts visible with its rows at its end in the first frame", async () => {
		const list = mount(pane(false), { anchor: "end", stickToBottom: true })
		list.addRows(60)
		await frames(1)
		expect(atEnd(list.viewport)).toBe(true)
		expect(list.fired).not.toContain("reachStart")
	})
})
