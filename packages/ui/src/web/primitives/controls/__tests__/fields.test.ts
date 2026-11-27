// @vitest-environment happy-dom
/** Lane W4 (A2): textField kinds and adornments, the searchable select, and the drop zone. */
import { afterEach, describe, expect, it } from "vitest"
import { create, type Primitive } from "../../../primitives.ts"
import type { Plain } from "../../define.ts"
import { accepts } from "../dropZone.ts"
import { takeDropped } from "../dropped.ts"

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

const part = <E extends Element = HTMLElement>(node: Element, name: string) =>
	node.querySelector(`[data-hz-part=${name}]`) as E
const key = (target: Element, name: string) => {
	const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })
	target.dispatchEvent(event)
	return event
}
const typeInto = (input: HTMLInputElement, text: string) => {
	input.value = text
	input.dispatchEvent(new Event("input", { bubbles: true }))
}

afterEach(() => {
	document.body.innerHTML = ""
})

describe("hz:textField kinds and adornments", () => {
	it("maps each kind to a type and inputmode that keep selection working", () => {
		const { node, set } = mount("textField", { label: "Email", inputKind: "email" })
		const input = part<HTMLInputElement>(node, "input")
		expect([input.type, input.inputMode, input.getAttribute("autocomplete")]).toEqual([
			"text",
			"email",
			"email",
		])
		expect(input.spellcheck).toBe(false)
		set("inputKind", "number")
		expect([input.type, input.inputMode]).toEqual(["text", "decimal"])
		set("inputKind", "url")
		expect(input.type).toBe("url")
		set("inputKind", "text")
		expect(input.type).toBe("text")
		expect(node.hasAttribute("data-input-kind")).toBe(false)
	})

	it("is named by its caption alone; prefix and suffix describe it", () => {
		const { node, set } = mount("textField", {
			label: "First response",
			prefix: "in",
			suffix: "minutes",
			description: "Business hours only.",
		})
		const input = part<HTMLInputElement>(node, "input")
		expect(document.getElementById(input.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
			"First response",
		)
		const described = () =>
			(input.getAttribute("aria-describedby") ?? "")
				.split(" ")
				.map((id) => document.getElementById(id)?.textContent)
		expect(described()).toEqual(["in", "minutes", "Business hours only."])
		set("prefix", null)
		set("error", "Too long.")
		expect(described()).toEqual(["minutes", "Business hours only.", "Too long."])
		expect(part(node, "prefix").hidden).toBe(true)
	})

	it("masks a secret until Show, which keeps the text and flips to Hide", () => {
		const { node, set } = mount("textField", {
			label: "API key",
			secret: true,
			value: { text: "sk_live_123", rev: 0, edit: 0 },
		})
		const input = part<HTMLInputElement>(node, "input")
		const reveal = part<HTMLButtonElement>(node, "reveal")
		expect(input.type).toBe("password")
		expect(reveal.hidden).toBe(false)
		expect([reveal.getAttribute("aria-label"), reveal.getAttribute("aria-pressed")]).toEqual([
			"Show",
			"false",
		])
		expect(reveal.getAttribute("aria-controls")).toBe(input.id)
		reveal.click()
		expect(input.type).toBe("text")
		expect(input.value).toBe("sk_live_123")
		expect([reveal.getAttribute("aria-label"), reveal.getAttribute("aria-pressed")]).toEqual([
			"Hide",
			"true",
		])
		set("secret", false)
		expect(reveal.hidden).toBe(true)
		expect(input.type).toBe("text")
	})

	it("raises copy from its copy button and shows Copied", () => {
		const { node, fired } = mount("textField", { label: "Webhook URL", copyable: true }, ["copy"])
		const copy = part<HTMLButtonElement>(node, "copy")
		expect(copy.getAttribute("aria-label")).toBe("Copy")
		copy.click()
		expect(fired).toEqual([["copy", {}]])
		expect(copy.getAttribute("aria-label")).toBe("Copied")
		expect(node.hasAttribute("data-copied")).toBe(true)
	})
})

const zones: Plain = [
	{ value: "Europe/Berlin", label: "Berlin", description: "UTC+1", group: "Europe" },
	{ value: "Europe/Zurich", label: "Zürich", description: "UTC+1", group: "Europe", disabled: true },
	{ value: "Europe/Lisbon", label: "Lisbon", description: "UTC+0", group: "Europe" },
	{ value: "America/New_York", label: "New York", description: "UTC-5", group: "Americas" },
]

const combobox = (props: Readonly<Record<string, Plain>> = {}) => {
	const mounted = mount(
		"select",
		{ label: "Time zone", searchable: true, options: zones, value: "Europe/Berlin", ...props },
		["change", "query"],
	)
	const input = part<HTMLInputElement>(mounted.node, "input")
	input.focus()
	const shown = () =>
		[...mounted.node.querySelectorAll<HTMLElement>("[role=option]")].map(
			(row) => row.querySelector("[data-hz-part=optionLabel]")?.textContent,
		)
	const active = () => document.getElementById(input.getAttribute("aria-activedescendant") ?? "")
	return { ...mounted, input, shown, active }
}

describe("hz:select searchable (the combo box)", () => {
	it("is a combobox input over a listbox, named by its label", () => {
		const { node, input } = combobox()
		expect(input.getAttribute("role")).toBe("combobox")
		expect(input.getAttribute("aria-autocomplete")).toBe("list")
		expect(input.getAttribute("aria-expanded")).toBe("false")
		expect(input.value).toBe("Berlin")
		expect(document.getElementById(input.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
			"Time zone",
		)
		expect(input.dataset.hzFocus).toBe("")
		expect(node.querySelector("select")).toBeNull()
		const button = part<HTMLButtonElement>(node, "button")
		expect(button.tabIndex).toBe(-1)
		expect(button.getAttribute("aria-label")).toBe("Show suggestions")
	})

	it("ArrowDown shows every option with the selection focused; arrows skip disabled ones; Enter picks", () => {
		const { node, input, shown, active, fired } = combobox()
		key(input, "ArrowDown")
		expect(input.getAttribute("aria-expanded")).toBe("true")
		expect(input.getAttribute("aria-controls")).toBe(part(node, "listbox").id)
		expect(shown()).toEqual(["Berlin", "Zürich", "Lisbon", "New York"])
		expect(active()?.dataset.value).toBe("Europe/Berlin")
		expect(active()?.getAttribute("aria-selected")).toBe("true")
		key(input, "ArrowDown")
		expect(active()?.dataset.value).toBe("Europe/Lisbon")
		key(input, "ArrowDown")
		key(input, "ArrowDown")
		// No wrapping: the last option stays focused.
		expect(active()?.dataset.value).toBe("America/New_York")
		key(input, "Enter")
		expect(fired).toEqual([["change", { value: "America/New_York" }]])
		expect(input.value).toBe("New York")
		expect(input.getAttribute("aria-expanded")).toBe("false")
		expect(input.hasAttribute("aria-activedescendant")).toBe(false)
	})

	it("draws groups as titled role=group sections with descriptions on the rows", () => {
		const { node, input } = combobox()
		key(input, "ArrowDown")
		const groups = [...node.querySelectorAll<HTMLElement>("[role=group]")]
		expect(
			groups.map(
				(group) => document.getElementById(group.getAttribute("aria-labelledby") ?? "")?.textContent,
			),
		).toEqual(["Europe", "Americas"])
		const zurich = node.querySelector<HTMLElement>("[data-value='Europe/Zurich']")
		expect(zurich?.getAttribute("aria-disabled")).toBe("true")
		expect(document.getElementById(zurich?.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
			"UTC+1",
		)
	})

	it("typing filters by label or description, ignoring accents, and raises query", () => {
		const { input, shown, fired, active } = combobox()
		typeInto(input, "zur")
		expect(fired).toEqual([["query", { text: "zur" }]])
		expect(shown()).toEqual(["Zürich"])
		expect(active()).toBeNull()
		typeInto(input, "utc-5")
		expect(shown()).toEqual(["New York"])
		key(input, "ArrowDown")
		key(input, "Enter")
		expect(fired.at(-1)).toEqual(["change", { value: "America/New_York" }])
	})

	it("closes when nothing matches, and Escape or blur put the chosen label back", () => {
		const { node, input, fired } = combobox()
		typeInto(input, "mars")
		expect(input.getAttribute("aria-expanded")).toBe("false")
		typeInto(input, "lis")
		expect(input.getAttribute("aria-expanded")).toBe("true")
		const escape = key(input, "Escape")
		expect(escape.defaultPrevented).toBe(true)
		expect(input.value).toBe("Berlin")
		expect(input.getAttribute("aria-expanded")).toBe("false")
		typeInto(input, "new")
		input.blur()
		expect(input.value).toBe("Berlin")
		expect(node.hasAttribute("data-open")).toBe(false)
		expect(fired.filter(([event]) => event === "change")).toEqual([])
	})

	it("a click picks an enabled option and ignores a disabled one", () => {
		const { node, input, fired } = combobox()
		key(input, "ArrowDown")
		node.querySelector<HTMLElement>("[data-value='Europe/Zurich'] [data-hz-part=optionLabel]")?.click()
		expect(fired).toEqual([])
		node.querySelector<HTMLElement>("[data-value='Europe/Lisbon']")?.click()
		expect(fired).toEqual([["change", { value: "Europe/Lisbon" }]])
		expect(input.value).toBe("Lisbon")
	})

	it("keeps the list open for its footer when nothing matches, and closes after a footer press", () => {
		const { content, input } = combobox()
		const create = document.createElement("button")
		create.textContent = "Create #mars"
		content.append(create)
		typeInto(input, "mars")
		expect(input.getAttribute("aria-expanded")).toBe("true")
		expect(part(content.parentElement as HTMLElement, "listbox").hidden).toBe(true)
		create.click()
		expect(input.getAttribute("aria-expanded")).toBe("false")
		expect(input.value).toBe("Berlin")
	})

	it("announces how many options show", () => {
		const { node, input } = combobox()
		key(input, "ArrowDown")
		expect(part(node, "status").textContent).toBe("4 options available.")
		typeInto(input, "berl")
		expect(part(node, "status").textContent).toBe("1 option available.")
	})

	it("options loaded for the typed text open the list", () => {
		const { input, set, shown } = combobox({ options: [] })
		typeInto(input, "par")
		expect(input.getAttribute("aria-expanded")).toBe("false")
		set("options", [{ value: "Europe/Paris", label: "Paris" }])
		expect(input.getAttribute("aria-expanded")).toBe("true")
		expect(shown()).toEqual(["Paris"])
	})
})

describe("hz:select native", () => {
	it("draws groups as optgroups and disabled options as disabled", () => {
		const { node } = mount("select", { label: "Time zone", options: zones, value: "Europe/Berlin" })
		const select = part<HTMLSelectElement>(node, "input")
		const groups = [...select.querySelectorAll("optgroup")]
		expect(groups.map((group) => group.label)).toEqual(["Europe", "Americas"])
		expect(groups[0]?.querySelectorAll("option").length).toBe(3)
		expect(select.querySelector<HTMLOptionElement>("option[value='Europe/Zurich']")?.disabled).toBe(true)
		expect(select.value).toBe("Europe/Berlin")
	})

	it("switches between native and searchable and moves the focus target", () => {
		const { node, set } = mount("select", { label: "Time zone", options: zones })
		expect(node.querySelector("[data-hz-focus]")?.tagName).toBe("SELECT")
		set("searchable", true)
		expect(node.querySelector("[data-hz-focus]")?.getAttribute("role")).toBe("combobox")
		set("searchable", false)
		expect(node.querySelector("[data-hz-focus]")?.tagName).toBe("SELECT")
		expect(part(node, "panel")).toBeNull()
	})
})

const file = (name: string, type: string) => new File(["x"], name, { type })
const drag = (target: Element, type: string, files: ReadonlyArray<File>) => {
	const event = new Event(type, { bubbles: true, cancelable: true })
	Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files, dropEffect: "none" } })
	target.dispatchEvent(event)
	return event
}

describe("hz:dropZone", () => {
	it("is a button named by its label and described by its description", () => {
		const { node } = mount("dropZone", { label: "Drop images here", description: "PNG up to 256 KB" })
		expect(node.tagName).toBe("BUTTON")
		expect(document.getElementById(node.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
			"Drop images here",
		)
		expect(document.getElementById(node.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
			"PNG up to 256 KB",
		)
	})

	it("holds the dropped files accept allows and raises files with their count", () => {
		const { node, fired } = mount(
			"dropZone",
			{ label: "Drop", accept: "image/png,.gif", multiple: true },
			["files"],
		)
		expect(drag(node, "dragenter", []).defaultPrevented).toBe(true)
		expect(node.hasAttribute("data-over")).toBe(true)
		drag(node, "drop", [file("a.png", "image/png"), file("b.txt", "text/plain"), file("c.GIF", "")])
		expect(node.hasAttribute("data-over")).toBe(false)
		expect(fired).toEqual([["files", { count: 2 }]])
		expect(takeDropped().map((each) => each.name)).toEqual(["a.png", "c.GIF"])
		expect(takeDropped()).toEqual([])
	})

	it("takes one file unless multiple, and nothing while disabled or loading", () => {
		const { node, fired, set } = mount("dropZone", { label: "Drop" }, ["files"])
		drag(node, "drop", [file("a.png", "image/png"), file("b.png", "image/png")])
		expect(fired).toEqual([["files", { count: 1 }]])
		set("loading", true)
		expect(node.getAttribute("aria-busy")).toBe("true")
		expect(drag(node, "drop", [file("a.png", "image/png")]).defaultPrevented).toBe(false)
		set("loading", false)
		set("disabled", true)
		drag(node, "drop", [file("a.png", "image/png")])
		expect(fired.length).toBe(1)
		takeDropped()
	})

	it("swallows presses while loading", () => {
		const { node, set } = mount("dropZone", { label: "Drop", loading: true })
		let clicks = 0
		document.body.addEventListener("click", () => clicks++)
		node.click()
		expect(clicks).toBe(0)
		set("loading", false)
		node.click()
		expect(clicks).toBe(1)
	})

	it("accepts by MIME type, wildcard and extension", () => {
		expect(accepts(undefined, { name: "a.zip", type: "application/zip" })).toBe(true)
		expect(accepts("image/*", { name: "a.webp", type: "image/webp" })).toBe(true)
		expect(accepts("image/*", { name: "a.zip", type: "application/zip" })).toBe(false)
		expect(accepts(".zip, .json", { name: "Export.ZIP", type: "" })).toBe(true)
	})
})
