// @vitest-environment happy-dom
/** Lane A2 (W12a): the composer's suggestions, context bar, `editLast` and `cancelContext`. */
import { describe, expect, it } from "vitest"
import type { Plain, Primitive } from "../../define.ts"
import { primitive as composer } from "../composer.ts"
import { editorOf } from "../composer/editor.ts"

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
		const view = editorOf(part("input")!)!
		view.someProp("handleTextInput", (handle) => handle(view, 1, 1, "/", () => view.state.tr))
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

describe("hz:composer G3", () => {
	it("says so when an open trigger finds nothing, and only then", () => {
		const { part, set } = mount({ emptyText: "No users found" }, ["trigger", "change"])
		const panel = part("suggestions")!
		expect(panel.hidden).toBe(true)
		const view = editorOf(part("input")!)!
		view.dispatch(view.state.tr.insertText("@"))
		view.someProp("handleTextInput", (handle) => handle(view, 1, 1, "@", () => view.state.tr))
		set("suggestions", [])
		expect(panel.hidden).toBe(false)
		expect(part("suggestionEmpty")?.textContent).toBe("No users found")
		set("suggestions", people)
		expect(part("suggestionEmpty")).toBeNull()
	})

	it("chips a command's arguments, required ones emphasized", () => {
		const { node } = mount(
			{
				suggestions: [
					{
						id: "deploy",
						label: "/deploy",
						description: "Ship a build",
						chips: [{ label: "env", required: true }, { label: "tag" }],
					},
				],
			},
			[],
		)
		const chips = [...node.querySelectorAll<HTMLElement>("[data-hz-part=suggestionChip]")]
		expect(chips.map((chip) => chip.textContent)).toEqual(["<env>", "[tag]"])
		expect(chips.map((chip) => chip.hasAttribute("data-emphasized"))).toEqual([true, false])
	})

	it("reports the row under the pointer, but not the active one", () => {
		const { fired, node } = mount({ suggestions: people, activeSuggestion: "u1" }, ["hoverSuggestion"])
		const [first, second] = [...node.querySelectorAll<HTMLElement>("[role=option]")]
		first!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))
		second!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))
		expect(fired).toEqual([["hoverSuggestion", { id: "u2" }]])
		expect(second!.hasAttribute("data-selected")).toBe(false)
		expect(first!.hasAttribute("data-selected")).toBe(true)
	})

	it("names mentions from `mentions`", () => {
		const { part, set } = mount({ value: { text: "hi @[userId:u9]", rev: 1, edit: 0 } }, [])
		expect(part("mention")?.textContent).toBe("@u9")
		set("mentions", [{ id: "u9", name: "Ada Lovelace" }])
		expect(part("mention")?.textContent).toBe("@Ada Lovelace")
	})

	it("raises escape with no context, and leave on Shift+Tab", () => {
		const { fired, part } = mount({}, ["escape", "leave"])
		const area = part("input")!
		expect(key(area, { key: "Escape" }).defaultPrevented).toBe(true)
		expect(key(area, { key: "Tab", shiftKey: true }).defaultPrevented).toBe(true)
		expect(key(area, { key: "Tab" }).defaultPrevented).toBe(false)
		expect(fired).toEqual([
			["escape", {}],
			["leave", {}],
		])
	})

	it("selects by markdown offsets and tears the editor down on dispose", () => {
		const made = composer.create({
			document,
			tag: "hz:composer",
			outer: (tagName) => {
				const node = document.createElement(tagName)
				node.dataset.hz = "composer"
				return node
			},
			self: (node, set) => ({ tag: "hz:composer", outer: node, content: node, set, events: undefined }),
		})
		document.body.append(made.outer)
		made.set("value", { text: "one **two** three", rev: 1, edit: 0 })
		const area = made.outer.querySelector<HTMLElement>("[data-hz-part=input]")!
		const view = editorOf(area)!
		made.select?.(4, 11)
		const { from, to } = view.state.selection
		expect(view.state.doc.textBetween(from, to)).toBe("**two**")
		made.dispose?.()
		expect(editorOf(area)).toBeUndefined()
		expect(view.isDestroyed).toBe(true)
	})
})
