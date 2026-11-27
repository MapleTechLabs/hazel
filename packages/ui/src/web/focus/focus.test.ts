// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { resolveLeafAnchor } from "./anchors.ts"
import { openLayer, openPanels } from "./layers.ts"
import { measureNode } from "./measure.ts"
import { place } from "./position.ts"

const key = (target: EventTarget, name: string, init: KeyboardEventInit = {}) => {
	const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init })
	target.dispatchEvent(event)
	return event
}
const press = (target: EventTarget) =>
	target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))

const html = (markup: string) => {
	document.body.innerHTML = markup
	return (selector: string) => document.querySelector<HTMLElement>(selector)!
}

afterEach(() => {
	// Close whatever a failed test left open, so the next one starts with an empty stack.
	for (const panel of openPanels(document)) panel.remove()
	key(document.body, "Shift")
})

describe("layer stack", () => {
	it("moves focus in, traps Tab in a modal layer, and returns focus on close", () => {
		const $ = html(`
			<button id="opener">open</button>
			<div id="panel"><input id="a" /><button id="b">b</button><button id="c">c</button></div>
			<button id="after">after</button>`)
		$("#opener").focus()
		const dismissed: Array<string> = []
		const layer = openLayer({
			panel: $("#panel"),
			modal: true,
			onDismiss: (reason) => dismissed.push(reason),
		})
		expect(document.activeElement).toBe($("#a"))

		$("#c").focus()
		expect(key($("#c"), "Tab").defaultPrevented).toBe(true)
		expect(document.activeElement).toBe($("#a"))
		key($("#a"), "Tab", { shiftKey: true })
		expect(document.activeElement).toBe($("#c"))
		// Focus that escapes (a script, a click on the page) is pulled back in.
		$("#after").focus()
		expect(document.activeElement).toBe($("#a"))

		key($("#a"), "Escape")
		expect(dismissed).toEqual(["escape"])
		layer.close()
		expect(document.activeElement).toBe($("#opener"))
		expect(openPanels(document)).toEqual([])
	})

	it("leaves focus where the user put it when they moved it outside a non-modal layer", () => {
		const $ = html(
			`<button id="opener">open</button><div id="panel"><button id="in">in</button></div><input id="elsewhere" />`,
		)
		$("#opener").focus()
		const layer = openLayer({
			panel: $("#panel"),
			modal: false,
			dismissOnOutside: true,
			onDismiss: () => {},
		})
		expect(document.activeElement).toBe($("#in"))
		$("#elsewhere").focus()
		layer.close()
		expect(document.activeElement).toBe($("#elsewhere"))
	})

	it("dismisses only the top layer on an outside press, and not for its trigger", () => {
		const $ = html(`
			<button id="trigger">t</button>
			<div id="outer"><button id="o">o</button><div id="inner"><button id="i">i</button></div></div>
			<p id="page">page</p>`)
		const reasons: Array<string> = []
		openLayer({
			panel: $("#outer"),
			modal: false,
			dismissOnOutside: true,
			onDismiss: (r) => reasons.push(`outer:${r}`),
		})
		openLayer({
			panel: $("#inner"),
			modal: false,
			dismissOnOutside: true,
			inside: () => [$("#trigger")],
			onDismiss: (r) => reasons.push(`inner:${r}`),
		})
		press($("#trigger"))
		press($("#i"))
		expect(reasons).toEqual([])
		press($("#o"))
		expect(reasons).toEqual(["inner:outside"])
	})

	it("closes the layers opened inside one that closes, telling them why", () => {
		const $ = html(`<div id="dialog"><button>x</button><div id="popover"><button>y</button></div></div>`)
		const reasons: Array<string> = []
		const dialog = openLayer({ panel: $("#dialog"), modal: true, onDismiss: () => {} })
		const popover = openLayer({ panel: $("#popover"), modal: false, onDismiss: (r) => reasons.push(r) })
		dialog.close()
		expect(reasons).toEqual(["parent"])
		expect(popover.isOpen()).toBe(false)
		expect(openPanels(document)).toEqual([])
	})

	it("leaves keys and presses in the app's own overlays to the app (Foldkit portal root, dialogs)", () => {
		const $ = html(`
			<div id="foldkit-portal-root"><div data-overlay-root="menu"><button id="app-item">app</button></div></div>
			<dialog open id="app-dialog"><button id="app-button">app</button><div id="island"><div id="panel"><button id="hz">hz</button></div></div></dialog>`)
		const reasons: Array<string> = []
		openLayer({
			panel: $("#panel"),
			modal: false,
			dismissOnOutside: true,
			onDismiss: (r) => reasons.push(r),
		})
		// The app's menu sits beside the hazel layer: its press and Escape are the app's.
		press($("#app-item"))
		expect(key($("#app-item"), "Escape").defaultPrevented).toBe(false)
		expect(reasons).toEqual([])
		// The app dialog holds the island: a press on its own button is outside the hazel popover, and
		// Escape inside the popover closes the popover, not the dialog (the key is consumed).
		press($("#app-button"))
		expect(reasons).toEqual(["outside"])
		expect(key($("#hz"), "Escape").defaultPrevented).toBe(true)
		expect(reasons).toEqual(["outside", "escape"])
	})

	it("lets a control inside the layer keep Escape for itself", () => {
		const $ = html(`<div id="panel"><input id="field" /></div>`)
		const reasons: Array<string> = []
		openLayer({ panel: $("#panel"), modal: true, onDismiss: (r) => reasons.push(r) })
		$("#field").addEventListener("keydown", (event) => event.preventDefault())
		key($("#field"), "Escape")
		expect(reasons).toEqual([])
	})

	it("closes a menu-like layer on Tab, focus back on the trigger first", () => {
		const $ = html(
			`<button id="trigger">t</button><div id="menu"><div tabindex="-1" id="item">a</div></div>`,
		)
		$("#trigger").focus()
		const reasons: Array<string> = []
		const layer = openLayer({
			panel: $("#menu"),
			modal: false,
			dismissOnTab: true,
			initialFocus: () => $("#item"),
			onDismiss: (r) => reasons.push(r),
		})
		expect(document.activeElement).toBe($("#item"))
		key($("#item"), "Tab")
		expect(reasons).toEqual(["tab"])
		expect(layer.isOpen()).toBe(false)
		expect(document.activeElement).toBe($("#trigger"))
	})
})

describe("placement", () => {
	const viewport = { width: 400, height: 300 }
	const panel = { width: 100, height: 80 }
	it("puts the panel on the asked side, aligned to the anchor", () => {
		expect(
			place(panel, { x: 50, y: 40, width: 60, height: 20 }, viewport, {
				side: "bottom",
				align: "start",
				gap: 4,
			}),
		).toEqual({
			x: 50,
			y: 64,
			side: "bottom",
		})
	})
	it("flips when the asked side has no room and the other has more", () => {
		const spot = place(panel, { x: 50, y: 250, width: 60, height: 20 }, viewport, {
			side: "bottom",
			align: "start",
			gap: 4,
		})
		expect(spot.side).toBe("top")
		expect(spot.y).toBe(250 - 4 - 80)
	})
	it("shifts into the viewport, 12px from its edges", () => {
		const spot = place(panel, { x: 380, y: 40, width: 10, height: 10 }, viewport, {
			side: "bottom",
			align: "start",
			gap: 4,
		})
		expect(spot.x).toBe(400 - 100 - 12)
	})
})

describe("measure and anchors", () => {
	it("measures a detached node as the empty rect", () => {
		expect(measureNode(document.createElement("div"))).toEqual({ x: 0, y: 0, width: 0, height: 0 })
	})

	it("resolves anchorTo at a keyed leaf's run, else the leaf, else nothing", () => {
		const $ = html(`
			<div data-hz="message" data-hz-key="m1" id="m1"><span data-hz-run="0">hi </span><span data-hz-run="2">@maya</span></div>
			<div data-hz="message"><span data-hz-run="1">@sam</span></div>`)
		expect(resolveLeafAnchor(document, { key: "m1", run: 2 })?.textContent).toBe("@maya")
		expect(resolveLeafAnchor(document, { key: "m1", run: 5 })).toBe($("#m1"))
		expect(resolveLeafAnchor(document, { key: "unknown", run: 1 })).toBeUndefined()
	})
})
