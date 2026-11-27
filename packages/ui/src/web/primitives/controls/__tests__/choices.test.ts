// @vitest-environment happy-dom
/** Lane A2 (phase 4, W3): choiceGroup, the checkbox toggle, the removable button and the slider. */
import { afterEach, describe, expect, it } from "vitest"
import type { Plain } from "../../define.ts"
import { create, type Primitive } from "../../../primitives.ts"
import { snap } from "../slider.ts"

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
	return { node: primitive.outer, fired, set: primitive.set }
}

const key = (target: Element, name: string) => {
	const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })
	target.dispatchEvent(event)
	return event
}
const part = <E extends Element = HTMLElement>(node: Element, name: string) =>
	node.querySelector(`[data-hz-part=${name}]`) as E
const options = (node: Element) => [...node.querySelectorAll<HTMLButtonElement>("[data-hz-part=option]")]

const theme: Array<Plain> = [
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
	{ value: "system", label: "System", description: "Follow the device" },
]

afterEach(() => document.body.replaceChildren())

describe("hz:choiceGroup", () => {
	it("is a labelled radiogroup with one tab stop on the selected radio", () => {
		const { node } = mount("choiceGroup", { label: "Theme", options: theme, selected: ["dark"] })
		const group = part(node, "options")
		expect(group.getAttribute("role")).toBe("radiogroup")
		expect(document.getElementById(group.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
			"Theme",
		)
		const [light, dark, system] = options(node)
		expect(light?.getAttribute("role")).toBe("radio")
		expect(dark?.getAttribute("aria-checked")).toBe("true")
		expect(options(node).map((each) => each.tabIndex)).toEqual([-1, 0, -1])
		expect(document.getElementById(system?.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
			"Follow the device",
		)
	})

	it("arrows move and select with wrap-around; a press selects; the selected one is not resent", () => {
		const { node, fired } = mount("choiceGroup", { options: theme, selected: ["dark"] }, ["change"])
		const [light, dark, system] = options(node)
		dark?.focus()
		key(dark as Element, "ArrowDown")
		expect(document.activeElement).toBe(system)
		key(system as Element, "ArrowRight")
		expect(document.activeElement).toBe(light)
		key(light as Element, "End")
		dark?.click()
		expect(fired).toEqual([
			["change", { selected: ["system"] }],
			["change", { selected: ["light"] }],
			["change", { selected: ["system"] }],
		])
	})

	it("several choices are checkboxes in a group: Space or a press toggles, arrows only move", () => {
		const { node, fired, set } = mount(
			"choiceGroup",
			{ options: theme, multiple: true, selected: ["light"], style: "chips" },
			["change"],
		)
		expect(part(node, "options").getAttribute("role")).toBe("group")
		const [light, dark, system] = options(node)
		expect(dark?.getAttribute("role")).toBe("checkbox")
		light?.focus()
		key(light as Element, "ArrowRight")
		expect(document.activeElement).toBe(dark)
		system?.click()
		set("selected", ["light", "system"])
		light?.click()
		expect(fired).toEqual([
			["change", { selected: ["light", "system"] }],
			["change", { selected: ["system"] }],
		])
		// The last pressed or focused option keeps the tab stop through a redraw.
		set("selected", ["system"])
		expect(light?.tabIndex).toBe(0)
	})

	it("skips disabled options and disables every option with the group", () => {
		const choices: Array<Plain> = [
			{ value: "light", label: "Light" },
			{ value: "dark", label: "Dark", disabled: true },
			{ value: "system", label: "System" },
		]
		const { node, fired, set } = mount("choiceGroup", { options: choices, selected: ["light"] }, [
			"change",
		])
		const [light, dark, system] = options(node)
		expect(dark?.disabled).toBe(true)
		light?.focus()
		key(light as Element, "ArrowDown")
		expect(document.activeElement).toBe(system)
		expect(fired).toEqual([["change", { selected: ["system"] }]])
		set("disabled", true)
		expect(options(node).every((each) => each.disabled)).toBe(true)
		expect(part(node, "options").getAttribute("aria-disabled")).toBe("true")
	})

	it("wires description and error to the group and marks it invalid", () => {
		const { node, set } = mount("choiceGroup", { options: theme, description: "Every device" })
		const group = part(node, "options")
		set("error", "Pick one")
		const ids = (group.getAttribute("aria-describedby") ?? "").split(" ")
		expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual([
			"Every device",
			"Pick one",
		])
		expect(group.getAttribute("aria-invalid")).toBe("true")
		expect(node.hasAttribute("data-invalid")).toBe(true)
	})

	it("swatches name each colour and draw it as data", () => {
		const { node } = mount("choiceGroup", {
			style: "swatches",
			options: [{ value: "brand", label: "Purple", swatch: "#6938EF" }],
			selected: ["brand"],
		})
		const [brand] = options(node)
		expect(brand?.getAttribute("aria-label")).toBe("Purple")
		expect(part(brand as Element, "box").style.backgroundColor).not.toBe("")
	})
})

describe("hz:toggle checkbox", () => {
	it("is a checkbox before its label; mixed asks for checked", () => {
		const { node, fired, set } = mount(
			"toggle",
			{ label: "Pin to top", style: "checkbox", indeterminate: true },
			["change"],
		)
		const control = part<HTMLButtonElement>(node, "control")
		expect(control.getAttribute("role")).toBe("checkbox")
		expect(control.getAttribute("aria-checked")).toBe("mixed")
		expect(node.firstElementChild).toBe(control)
		control.click()
		set("indeterminate", false)
		set("checked", true)
		expect(control.getAttribute("aria-checked")).toBe("true")
		expect(part(node, "mark").hidden).toBe(false)
		control.click()
		expect(fired).toEqual([
			["change", { checked: true }],
			["change", { checked: false }],
		])
		set("style", "switch")
		expect(control.getAttribute("role")).toBe("switch")
		expect(node.lastElementChild).toBe(control)
	})
})

describe("hz:button removable", () => {
	it("a press on the mark or Delete raises remove, not press", () => {
		const { node, fired } = mount("button", { label: "Plan: Pro", variant: "chip", removable: true }, [
			"press",
			"remove",
		])
		const presses: Array<Event> = []
		node.addEventListener("click", (event) => presses.push(event))
		part(node, "remove").click()
		expect(key(node, "Delete").defaultPrevented).toBe(true)
		expect(fired).toEqual([
			["remove", {}],
			["remove", {}],
		])
		expect(presses).toHaveLength(0)
		expect(node.getAttribute("aria-keyshortcuts")).toBe("Delete")
		expect(part(node, "remove").getAttribute("aria-hidden")).toBe("true")
	})
})

describe("hz:slider", () => {
	it("is a labelled role=slider with its range and value text", () => {
		const { node } = mount("slider", { label: "Volume", value: 0.6, max: 1, step: 0.1, valueText: "60%" })
		const thumb = part(node, "thumb")
		expect(thumb.getAttribute("role")).toBe("slider")
		expect(document.getElementById(thumb.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
			"Volume",
		)
		expect(thumb.getAttribute("aria-valuenow")).toBe("0.6")
		expect(thumb.getAttribute("aria-valuemax")).toBe("1")
		expect(thumb.getAttribute("aria-valuetext")).toBe("60%")
		expect(part(node, "value").textContent).toBe("60%")
	})

	it("steps with arrows, pages by ten, jumps with Home and End, within the range", () => {
		const { node, fired } = mount("slider", { label: "Volume", value: 0.6, max: 1, step: 0.1 }, [
			"change",
		])
		const thumb = part(node, "thumb")
		for (const name of ["ArrowRight", "ArrowDown", "PageDown", "PageUp", "Home", "End"]) key(thumb, name)
		expect(fired.map(([, payload]) => payload)).toEqual([
			{ value: 0.7 },
			{ value: 0.5 },
			{ value: 0 },
			{ value: 1 },
			{ value: 0 },
			{ value: 1 },
		])
	})

	it("snaps onto the step grid from min without float noise", () => {
		expect(snap(0.30000000000000004, 0, 1, 0.1)).toBe(0.3)
		expect(snap(47, 10, 90, 5)).toBe(45)
		expect(snap(120, 0, 100, 1)).toBe(100)
	})
})
