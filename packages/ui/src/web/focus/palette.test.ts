// @vitest-environment happy-dom
/** Lane A3 (W6): the command palette's keyboard, the hover card, the loading toast, and modal isolation. */
import { afterEach, describe, expect, it } from "vitest"
import type { Plain } from "../primitives/define.ts"
import { shortcutLabel } from "../primitives/overlays/commandPalette.ts"
import { create, type Primitive } from "../primitives.ts"
import { inertOthers, lockScroll } from "./isolate.ts"
import { openPanels } from "./layers.ts"

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

/** A primitive with `props` set and every event in `on` recorded as `[event, payload]`. */
const mount = (tag: string, props: Readonly<Record<string, Plain>>, on: ReadonlyArray<string> = []) => {
	const primitive = create(document, `hz:${tag}`) as Primitive
	const fired: Array<readonly [string, Plain]> = []
	primitive.events = {
		handlers: Object.fromEntries(on.map((name) => [name, name])),
		dispatch: (event, _handler, payload) => {
			fired.push([event, payload])
			return true
		},
	}
	for (const [name, value] of Object.entries(props)) primitive.set(name, value)
	document.body.append(primitive.outer)
	return { node: primitive.outer, fired, set: primitive.set, content: primitive.content }
}

const key = (target: Element, name: string) =>
	target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }))
const part = <E extends Element = HTMLElement>(node: Element, name: string) =>
	node.querySelector(`[data-hz-part=${name}]`) as E
const highlighted = (node: Element) =>
	[...node.querySelectorAll("[data-hz-part=item][data-highlighted]")].map((item) => item.textContent)

const invite = { id: "invite", label: "Invite members", description: "Send an email invite" }
const groups: Plain = [
	{ title: "Recent", items: [{ id: "c1", label: "general", icon: "hashtag" }] },
	{
		title: "Actions",
		items: [{ id: "new", label: "New channel", icon: "plus", shortcut: "mod+shift+n" }, invite],
	},
]
const query = (text: string, rev: number) => ({ text, rev, edit: 0 })

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.removeAttribute("style")
})

describe("hz:commandPalette", () => {
	it("opens modal with focus in the field, isolates the page, and moves a wrapping highlight", async () => {
		document.body.innerHTML = `<main id="page"><button id="opener">open</button></main>`
		const opener = document.getElementById("opener")!
		opener.focus()
		const { node, fired } = mount("commandPalette", { open: true, groups, query: query("", 0) }, [
			"change",
			"select",
			"dismiss",
		])
		await settle()
		const input = part<HTMLInputElement>(node, "input")
		expect(document.activeElement).toBe(input)
		expect(openPanels(document)).toEqual([part(node, "panel")])
		expect(document.getElementById("page")!.inert).toBe(true)
		expect(document.getElementById("page")!.getAttribute("aria-hidden")).toBe("true")
		expect(document.documentElement.style.overflow).toBe("hidden")

		expect(highlighted(node)).toEqual([])
		key(input, "ArrowUp")
		expect(highlighted(node)).toEqual(["Invite membersSend an email invite"])
		key(input, "ArrowDown")
		expect(highlighted(node)).toEqual(["general"])
		expect(input.getAttribute("aria-activedescendant")).toBe(part(node, "item").id)
		key(input, "Enter")
		expect(fired).toEqual([["select", { id: "c1" }]])
		const [, newChannel] = [...node.querySelectorAll<HTMLElement>("[data-hz-part=item]")]
		expect(newChannel!.querySelector("kbd")?.textContent).toMatch(/^(⌘⇧N|Ctrl\+Shift\+N)$/)
		newChannel!.click()
		expect(fired.at(-1)).toEqual(["select", { id: "new" }])
	})

	it("typing highlights the first result; Escape clears the query, then asks to close", async () => {
		const { node, fired, set } = mount("commandPalette", { open: true, groups, query: query("", 0) }, [
			"change",
			"select",
			"dismiss",
		])
		await settle()
		const input = part<HTMLInputElement>(node, "input")
		input.value = "inv"
		input.dispatchEvent(new Event("input", { bubbles: true }))
		expect(fired).toEqual([["change", { value: "inv", rev: 1, edit: 0 }]])
		// The screen filters; the new results highlight their first item.
		set("groups", [{ title: "Actions", items: [invite] }])
		expect(highlighted(node)).toEqual(["Invite membersSend an email invite"])

		key(input, "Escape")
		expect(input.value).toBe("")
		expect(fired.at(-1)).toEqual(["change", { value: "", rev: 2, edit: 0 }])
		expect(fired.some(([event]) => event === "dismiss")).toBe(false)
		key(input, "Escape")
		expect(fired.at(-1)).toEqual(["dismiss", {}])

		set("open", false)
		await settle()
		expect(openPanels(document)).toEqual([])
		expect(document.documentElement.style.overflow).toBe("")
	})

	it("shows the empty line, a spinner while loading, and a form page with Back", async () => {
		const { node, fired, set } = mount(
			"commandPalette",
			{ open: false, groups: [], empty: "No channels" },
			["back", "dismiss"],
		)
		expect(part(node, "empty").textContent).toBe("No channels")
		expect(part(node, "empty").hidden).toBe(false)
		set("loading", true)
		expect(part(node, "empty").hidden).toBe(true)
		expect(part(node, "results").getAttribute("aria-busy")).toBe("true")
		expect(node.querySelector("[data-hz-spinner]")?.hasAttribute("hidden")).toBe(false)

		set("title", "Create channel")
		set("open", true)
		await settle()
		expect(part(node, "field").hidden).toBe(true)
		expect(part(node, "header").hidden).toBe(false)
		expect(part(node, "panel").getAttribute("aria-labelledby")).toBe(part(node, "title").id)
		part(node, "back").click()
		expect(fired).toEqual([["back", {}]])
	})

	it("labels shortcuts as today's key caps", () => {
		expect(shortcutLabel("mod+shift+n", true)).toBe("⌘⇧N")
		expect(shortcutLabel("mod+k", false)).toBe("Ctrl+K")
		expect(shortcutLabel("⌘K", true)).toBe("⌘K")
	})
})

describe("hz:popover trigger hover", () => {
	it("shows after the delay without taking focus, hides and asks to close on leave", async () => {
		document.body.innerHTML = `<button id="elsewhere">x</button>`
		const elsewhere = document.getElementById("elsewhere")!
		elsewhere.focus()
		const { node, fired } = mount("popover", { trigger: "hover", open: true }, ["dismiss"])
		const panel = part(node, "panel")
		await settle()
		expect(panel.hasAttribute("data-open")).toBe(false)
		expect(panel.getAttribute("role")).toBe("tooltip")

		node.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }))
		await settle(100)
		expect(panel.hasAttribute("data-open")).toBe(false)
		await settle(400)
		expect(panel.hasAttribute("data-open")).toBe(true)
		expect(document.activeElement).toBe(elsewhere)

		node.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }))
		await settle()
		expect(panel.hasAttribute("data-open")).toBe(false)
		expect(fired).toEqual([["dismiss", {}]])
	})
})

describe("hz:toast loading", () => {
	it("leads with a spinner and is busy", () => {
		const { node, set } = mount("toast", { open: true, title: "Exporting...", loading: true })
		const panel = part(node, "panel")
		expect(panel.getAttribute("aria-busy")).toBe("true")
		expect(part(node, "spinner").hidden).toBe(false)
		set("loading", false)
		expect(panel.hasAttribute("aria-busy")).toBe(false)
		expect(part(node, "spinner").hidden).toBe(true)
	})
})

describe("isolation", () => {
	it("counts nested scroll locks and inert marks, keeping what was there before", () => {
		document.body.innerHTML = `<div id="a" aria-hidden="false"></div><div id="b" inert></div><div id="keep"></div>`
		const [a, b, keep] = ["a", "b", "keep"].map((id) => document.getElementById(id)!)
		document.documentElement.style.overflow = "scroll"
		const unlockOne = lockScroll(document)
		const unlockTwo = lockScroll(document)
		const restoreOne = inertOthers(keep!)
		const restoreTwo = inertOthers(keep!)
		expect([a!.inert, b!.inert, keep!.inert]).toEqual([true, true, false])
		expect(a!.getAttribute("aria-hidden")).toBe("true")
		unlockOne()
		restoreOne()
		expect(document.documentElement.style.overflow).toBe("hidden")
		expect(a!.inert).toBe(true)
		unlockTwo()
		restoreTwo()
		restoreTwo()
		expect(document.documentElement.style.overflow).toBe("scroll")
		expect([a!.inert, b!.inert]).toEqual([false, true])
		expect(a!.getAttribute("aria-hidden")).toBe("false")
	})
})
