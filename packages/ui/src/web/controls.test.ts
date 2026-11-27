// @vitest-environment happy-dom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** Lane A2: the controls' keyboard, ARIA and events, and the web host's `select` command. */
import { Context, Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { Hazel } from "../vocabulary/index.ts"
import * as WebHost from "./host.ts"
import type { Plain } from "./primitives/define.ts"
import { create, type Primitive } from "./primitives.ts"

/** A control with `props` set and every event in `on` recorded as `[event, payload]`. */
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

const key = (target: Element, init: KeyboardEventInit) => {
	const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
	target.dispatchEvent(event)
	return event
}
const typeInto = (control: HTMLInputElement | HTMLTextAreaElement, text: string) => {
	control.value += text
	control.setSelectionRange(control.value.length, control.value.length)
	control.dispatchEvent(new Event("input", { bubbles: true }))
}
const part = <E extends Element = HTMLElement>(node: Element, name: string) =>
	node.querySelector(`[data-hz-part=${name}]`) as E

describe("hz:button", () => {
	it("is a native button with its options as attributes; iconOnly names it by aria-label", () => {
		const { node, set } = mount("button", {
			label: "Invite",
			variant: "ghost",
			size: "small",
			icon: "plus",
		})
		expect(node.tagName).toBe("BUTTON")
		expect(node.getAttribute("type")).toBe("button")
		expect(node.dataset.variant).toBe("ghost")
		expect(node.dataset.size).toBe("small")
		expect(part(node, "label").textContent).toBe("Invite")
		expect(part(node, "icon").getAttribute("aria-hidden")).toBe("true")
		set("iconOnly", true)
		expect(node.hasAttribute("data-icon-only")).toBe(true)
		expect(part(node, "label")).toBeNull()
		expect(node.getAttribute("aria-label")).toBe("Invite")
	})

	it("disabled is native; loading stays focusable, busy, and swallows clicks", () => {
		const { node, set } = mount("button", { label: "Invite", loading: true })
		let clicks = 0
		document.body.addEventListener("click", () => clicks++)
		node.click()
		expect(clicks).toBe(0)
		expect(node.getAttribute("aria-busy")).toBe("true")
		expect((node as HTMLButtonElement).disabled).toBe(false)
		set("loading", false)
		node.click()
		expect(clicks).toBe(1)
		set("disabled", true)
		expect((node as HTMLButtonElement).disabled).toBe(true)
	})
})

describe("hz:link", () => {
	it("is an a href that cancels a plain click it handles, and a button without href", () => {
		const { node, set } = mount("link", { label: "Learn more", href: "#docs" }, ["press"])
		const anchor = part<HTMLAnchorElement>(node, "control")
		expect(anchor.tagName).toBe("A")
		expect(anchor.getAttribute("href")).toBe("#docs")
		const plain = new MouseEvent("click", { bubbles: true, cancelable: true })
		anchor.dispatchEvent(plain)
		expect(plain.defaultPrevented).toBe(true)
		const modified = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true })
		anchor.dispatchEvent(modified)
		expect(modified.defaultPrevented).toBe(false)
		set("href", null)
		const button = part(node, "control")
		expect(button.tagName).toBe("BUTTON")
		expect(button.textContent).toBe("Learn more")
	})
})

describe("hz:toggle", () => {
	it("is a labelled switch that asks the Model for the next value", () => {
		const { node, fired, set } = mount("toggle", { label: "Notifications", description: "Mentions" }, [
			"change",
		])
		const control = part<HTMLButtonElement>(node, "control")
		expect(control.getAttribute("role")).toBe("switch")
		expect(control.getAttribute("aria-checked")).toBe("false")
		expect(document.getElementById(control.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
			"Notifications",
		)
		expect(document.getElementById(control.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
			"Mentions",
		)
		control.click()
		expect(fired).toEqual([["change", { checked: true }]])
		expect(control.getAttribute("aria-checked")).toBe("false")
		set("checked", true)
		expect(control.getAttribute("aria-checked")).toBe("true")
		control.click()
		expect(fired.at(-1)).toEqual(["change", { checked: false }])
	})
})

describe("hz:select", () => {
	it("shows the placeholder until a value matches, and raises change", () => {
		const options = [
			{ value: "all", label: "All" },
			{ value: "none", label: "Nothing" },
		]
		const { node, fired, set } = mount("select", { label: "Notify", placeholder: "Choose", options }, [
			"change",
		])
		const select = part<HTMLSelectElement>(node, "input")
		expect(select.closest("label")?.textContent).toContain("Notify")
		expect(node.hasAttribute("data-placeholder")).toBe(true)
		expect(select.selectedOptions[0]?.textContent).toBe("Choose")
		set("value", "none")
		expect(select.value).toBe("none")
		expect(node.hasAttribute("data-placeholder")).toBe(false)
		select.value = "all"
		select.dispatchEvent(new Event("change", { bubbles: true }))
		expect(fired).toEqual([["change", { value: "all" }]])
	})
})

describe("text controls", () => {
	it("textField wires description and error to the input and marks required", () => {
		const { node, set } = mount("textField", { label: "Name", description: "Shown to everyone" })
		const input = part<HTMLInputElement>(node, "input")
		const describedBy = () => (input.getAttribute("aria-describedby") ?? "").split(" ")
		expect(describedBy()).toEqual([part(node, "description").id])
		set("error", "Required")
		expect(describedBy()).toEqual([part(node, "description").id, part(node, "error").id])
		expect(input.getAttribute("aria-invalid")).toBe("true")
		set("required", true)
		expect(input.required).toBe(true)
		expect(part(node, "required").hidden).toBe(false)
	})

	it("textArea: Enter is a new line, Cmd or Ctrl+Enter submits the current revision", () => {
		const { node, fired } = mount("textArea", { label: "About" }, ["change", "submit", "focus"])
		const area = part<HTMLTextAreaElement>(node, "input")
		area.dispatchEvent(new FocusEvent("focus"))
		typeInto(area, "hi")
		expect(key(area, { key: "Enter" }).defaultPrevented).toBe(false)
		expect(key(area, { key: "Enter", ctrlKey: true }).defaultPrevented).toBe(true)
		expect(fired).toEqual([
			["focus", {}],
			["change", { value: "hi", rev: 1, edit: 0 }],
			["submit", { value: "hi", rev: 1, edit: 0 }],
		])
	})

	it("searchField: Enter submits, Escape clears through change", () => {
		const { node, fired } = mount("searchField", { placeholder: "Search channels" }, ["change", "submit"])
		const input = part<HTMLInputElement>(node, "input")
		expect(input.type).toBe("search")
		expect(input.getAttribute("aria-label")).toBe("Search channels")
		typeInto(input, "de")
		key(input, { key: "Enter" })
		key(input, { key: "Escape" })
		expect(input.value).toBe("")
		expect(fired).toEqual([
			["change", { value: "de", rev: 1, edit: 0 }],
			["submit", { value: "de", rev: 1, edit: 0 }],
			["change", { value: "", rev: 2, edit: 0 }],
		])
	})
})

describe("hz:composer", () => {
	it("is a labelled textbox with a send button that sends only when it can", () => {
		const { node, fired, set } = mount("composer", { placeholder: "Message #general" }, ["submit"])
		const input = part(node, "input")
		const send = part<HTMLButtonElement>(node, "send")
		expect(input.getAttribute("role")).toBe("textbox")
		expect(input.getAttribute("aria-label")).toBe("Message #general")
		expect(input.hasAttribute("data-hz-focus")).toBe(true)
		expect(send.disabled).toBe(true)
		expect(key(input, { key: "Enter" }).defaultPrevented).toBe(true)
		expect(fired).toEqual([])
		set("value", { text: "hi", rev: 0, edit: 1 })
		set("canSend", true)
		expect(send.disabled).toBe(false)
		key(input, { key: "Enter" })
		send.click()
		expect(fired).toEqual([
			["submit", { value: "hi", rev: 0, edit: 1 }],
			["submit", { value: "hi", rev: 0, edit: 1 }],
		])
	})
})

describe("web host commands", () => {
	it("focus and select reach a field's input, and select sets the range", async () => {
		const { node } = mount("textField", { label: "Name", value: { text: "Hazel chat", rev: 0, edit: 0 } })
		const input = part<HTMLInputElement>(node, "input")
		const commands = await Effect.gen(function* () {
			const context = yield* Layer.build(WebHost.layer())
			return Context.get(context, Hazel.Host)
		}).pipe(Effect.scoped, Effect.runPromise)
		await Effect.runPromise(commands.select(node, { start: 6, end: 10 }))
		expect(document.activeElement).toBe(input)
		expect([input.selectionStart, input.selectionEnd]).toEqual([6, 10])
		await Effect.runPromise(commands.blur(node))
		expect(document.activeElement).not.toBe(input)
		await Effect.runPromise(commands.focus(node))
		expect(document.activeElement).toBe(input)
	})
})
