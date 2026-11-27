// @vitest-environment happy-dom
/** Lane A2 (W12a): the composer's suggestions, context bar, `editLast` and `cancelContext`. */
import { describe, expect, it } from "vitest"
import type { Plain, Primitive } from "../../define.ts"
import { primitive as composer } from "../composer.ts"

const mount = (props: Readonly<Record<string, Plain>>, on: ReadonlyArray<string>) => {
	const made: Primitive = composer.create({
		document,
		tag: "hz:composer",
		outer: (tagName) => {
			const node = document.createElement(tagName)
			node.dataset.hz = "composer"
			return node
		},
		self: (node, set) => ({ tag: "hz:composer", outer: node, content: node, set, events: undefined }),
	})
	const fired: Array<readonly [string, Plain]> = []
	made.events = {
		handlers: Object.fromEntries(on.map((name) => [name, name])),
		dispatch: (event, _handler, payload) => {
			fired.push([event, payload])
			return true
		},
	}
	for (const [name, value] of Object.entries(props)) made.set(name, value)
	document.body.append(made.outer)
	const part = (name: string) => made.outer.querySelector<HTMLElement>(`[data-hz-part=${name}]`)
	return { node: made.outer, fired, set: made.set, part }
}

const key = (target: Element, init: KeyboardEventInit) => {
	const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
	target.dispatchEvent(event)
	return event
}

const people = [
	{
		id: "u1",
		label: "Maya Chen",
		description: "Design",
		group: "Members",
		face: { name: "Maya Chen", initials: "MC", presence: "online" },
	},
	{
		id: "u2",
		label: "Leo Park",
		group: "Members",
		face: { name: "Leo Park", initials: "LP" },
		mark: "slack",
	},
	{ id: "here", label: "@here", description: "Notify everyone online", group: "Groups", icon: "users" },
] as const

describe("hz:composer suggestions", () => {
	it("draws a listbox of grouped options with the active one selected, and reports presses", () => {
		const { fired, set, part, node } = mount({ suggestions: people, activeSuggestion: "u2" }, [
			"pressSuggestion",
		])
		const panel = part("suggestions")!
		const area = part("input")!
		expect(panel.hidden).toBe(false)
		expect(panel.getAttribute("role")).toBe("listbox")
		expect(area.getAttribute("aria-controls")).toBe(panel.id)
		const options = [...node.querySelectorAll<HTMLElement>("[role=option]")]
		expect(options.map((row) => row.textContent)).toEqual([
			"MMaya ChenDesign",
			"LLeo Park",
			"@hereNotify everyone online",
		])
		expect(
			[...node.querySelectorAll("[data-hz-part=suggestionGroup]")].map(
				(heading) => heading.textContent,
			),
		).toEqual(["Members", "Groups"])
		expect(options.map((row) => row.getAttribute("aria-selected"))).toEqual(["false", "true", "false"])
		expect(area.getAttribute("aria-activedescendant")).toBe(options[1]!.id)
		expect(node.querySelector("[data-hz-part=suggestionPresence]")?.getAttribute("data-presence")).toBe(
			"online",
		)
		expect(node.querySelector("[data-hz-part=suggestionMark]")?.getAttribute("data-mark")).toBe("slack")

		set("activeSuggestion", "here")
		expect(options[2]!.getAttribute("aria-selected")).toBe("true")
		const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
		options[0]!.querySelector("[data-hz-part=suggestionLabel]")!.dispatchEvent(press)
		expect(press.defaultPrevented).toBe(true)
		;(options[0]!.querySelector("[data-hz-part=suggestionLabel]") as HTMLElement).click()
		expect(fired).toEqual([["pressSuggestion", { id: "u1" }]])

		set("suggestions", [])
		expect(panel.hidden).toBe(true)
		expect(area.hasAttribute("aria-activedescendant")).toBe(false)
		expect(area.hasAttribute("aria-controls")).toBe(false)
	})

	it("draws emoji glyphs and custom emoji images, and today's command rows under `/`", () => {
		const { part, node, set } = mount({}, ["trigger"])
		set("suggestions", [
			{ id: "tada", label: ":tada:", emoji: "🎉" },
			{ id: "party", label: ":party:", emoji: "https://cdn.example/party.png" },
		])
		expect(node.querySelector("span[data-hz-part=suggestionEmoji]")?.textContent).toBe("🎉")
		expect(node.querySelector("img[data-hz-part=suggestionEmoji]")?.getAttribute("src")).toBe(
			"https://cdn.example/party.png",
		)
		const area = part("input") as HTMLTextAreaElement
		area.value = "/dep"
		area.setSelectionRange(4, 4)
		area.dispatchEvent(new Event("input", { bubbles: true }))
		expect(part("suggestions")!.dataset.trigger).toBe("/")
	})
})

describe("hz:composer context", () => {
	it("draws the reply bar and the edit bar, and closes with the button or Escape", () => {
		const { fired, set, part, node } = mount(
			{ context: { kind: "reply", author: "Maya Chen", text: "Can we ship it today?" } },
			["cancelContext"],
		)
		const bar = part("context")!
		expect(bar.hidden).toBe(false)
		expect(node.hasAttribute("data-context")).toBe(true)
		expect(bar.textContent).toBe("Replying toMaya ChenCan we ship it today?")
		const close = bar.querySelector<HTMLButtonElement>("[data-hz=button]")!
		expect(close.getAttribute("aria-label")).toBe("Cancel reply")
		close.click()
		expect(fired).toEqual([["cancelContext", {}]])

		set("context", { kind: "edit", text: "Shipping today" })
		expect(bar.textContent).toBe("Editing message")
		expect(close.getAttribute("aria-label")).toBe("Cancel editing")
		expect(key(part("input")!, { key: "Escape" }).defaultPrevented).toBe(true)
		expect(fired).toHaveLength(2)

		set("context", null)
		expect(bar.hidden).toBe(true)
		expect(node.hasAttribute("data-context")).toBe(false)
		expect(key(part("input")!, { key: "Escape" }).defaultPrevented).toBe(false)
		expect(fired).toHaveLength(2)
	})

	it("raises editLast on Up in an empty composer only", () => {
		const { fired, part, set } = mount({}, ["editLast", "change"])
		const area = part("input")!
		expect(key(area, { key: "ArrowUp" }).defaultPrevented).toBe(true)
		expect(key(area, { key: "ArrowUp", shiftKey: true }).defaultPrevented).toBe(false)
		set("value", { text: "draft", rev: 0, edit: 0 })
		expect(key(area, { key: "ArrowUp" }).defaultPrevented).toBe(false)
		expect(fired.filter(([event]) => event === "editLast")).toHaveLength(1)
	})
})
