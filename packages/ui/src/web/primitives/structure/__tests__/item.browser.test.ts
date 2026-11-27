/**
 * The item's unread badge in Chromium: at rest at the row's end, sliding 24px toward the start on
 * hover when the row has hover actions (today's `right-1.5` to `group-hover:right-8`), animated.
 * Runs in Vitest's browser mode only; `vitest run` under Node skips it.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import type { Primitive } from "../../define.ts"

const inBrowser = typeof navigator !== "undefined" && /Chrome|HeadlessChrome/.test(navigator.userAgent)

let Item: typeof import("../item.ts")
let hover: (element: Element) => Promise<void>

beforeAll(async () => {
	if (!inBrowser) return
	await import("../../../../style/generated/tokens.css")
	hover = (await import("vitest/browser")).userEvent.hover
	Item = await import("../item.ts")
})

afterEach(() => {
	if (inBrowser) document.body.replaceChildren()
})

const mount = (withActions: boolean) => {
	const made: Primitive = Item.primitive.create({
		document,
		tag: "hz:item",
		outer: (tagName) => {
			const node = document.createElement(tagName)
			node.dataset.hz = "item"
			return node
		},
		self: (node, set) => ({ tag: "hz:item", outer: node, content: node, set, events: undefined }),
	})
	made.set("title", "design")
	made.set("badge", 3)
	if (withActions) {
		const slot = document.createElement("span")
		slot.dataset.hzSlot = "actions"
		slot.append(document.createElement("button"))
		made.content.append(slot)
	}
	const frame = document.createElement("div")
	frame.style.width = "296px"
	frame.append(made.outer)
	document.body.append(frame)
	return made.outer.querySelector<HTMLElement>('[data-hz-part="badge"]')!
}

describe.runIf(inBrowser)("item badge on hover", () => {
	it("rests at the end and slides 24px toward the start, as a transition from the motion tokens", async () => {
		const badge = mount(true)
		expect(getComputedStyle(badge).translate).toBe("none")
		expect(getComputedStyle(badge).transitionProperty).toContain("translate")
		expect(getComputedStyle(badge).transitionDuration).toBe("0.15s")
		await hover(badge.closest('[data-hz="item"]')!)
		// Running: the badge's own transition, not a jump.
		expect(badge.getAnimations().map((a) => (a as CSSTransition).transitionProperty)).toContain(
			"translate",
		)
		await new Promise((resolve) => setTimeout(resolve, 250))
		expect(getComputedStyle(badge).translate).toBe("-24px")
	})

	it("stays put on a row without hover actions", async () => {
		const badge = mount(false)
		await hover(badge.closest('[data-hz="item"]')!)
		expect(getComputedStyle(badge).translate).toBe("none")
	})
})
