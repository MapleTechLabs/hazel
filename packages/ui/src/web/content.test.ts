// @vitest-environment happy-dom
/** Lane W1 (A1): the phase 4 content primitives' structure, ARIA, events and highlighting. */
import { describe, expect, it } from "vitest"
import type { Plain } from "./primitives/define.ts"
import { create, type Primitive } from "./primitives.ts"

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

const part = <E extends Element = HTMLElement>(node: Element, name: string) =>
	node.querySelector(`[data-hz-part=${name}]`) as E

describe("hz:banner", () => {
	it("is a status, an alert in danger, and raises dismiss from its close button", () => {
		const { node, fired, set } = mount("banner", { title: "Saved", dismissible: true }, ["dismiss"])
		expect(node.getAttribute("role")).toBe("status")
		expect(part(node, "title").textContent).toBe("Saved")
		expect(part(node, "description").hidden).toBe(true)
		expect(part(node, "icon").hidden).toBe(true)
		set("tone", "danger")
		expect(node.getAttribute("role")).toBe("alert")
		const dismiss = part<HTMLButtonElement>(node, "dismiss")
		expect(dismiss.getAttribute("aria-label")).toBe("Dismiss")
		dismiss.click()
		expect(fired).toEqual([["dismiss", {}]])
		set("dismissible", false)
		expect(dismiss.hidden).toBe(true)
	})

	it("mounts its children after the title and description", () => {
		const { node, content } = mount("banner", { title: "Token created" })
		expect(content).toBe(part(node, "content"))
		expect(content.firstElementChild).toBe(part(node, "title"))
	})
})

describe("hz:codeBlock", () => {
	it("highlights by language and raises copy, reading Copied for a moment", () => {
		const { node, fired } = mount(
			"codeBlock",
			{ code: 'const a = "b"', language: "ts", title: "Example", copyable: true },
			["copy"],
		)
		const code = node.querySelector("pre > code") as HTMLElement
		expect(code.textContent).toBe('const a = "b"')
		expect(code.querySelector("[data-syntax=keyword]")?.textContent).toBe("const")
		expect(code.querySelector("[data-syntax=string]")?.textContent).toBe('"b"')
		const copy = part<HTMLButtonElement>(node, "copy")
		expect(copy.textContent).toBe("Copy")
		copy.click()
		expect(fired).toEqual([["copy", {}]])
		expect(copy.textContent).toBe("Copied")
	})

	it("hides its header with no title and no copy button, and draws plain text unhighlighted", () => {
		const { node } = mount("codeBlock", { code: "plain words" })
		expect(part(node, "header").hidden).toBe(true)
		expect(node.querySelector("[data-syntax]")).toBeNull()
	})
})

describe("hz:richText", () => {
	it("raises copyCode with the block's index and highlights the code", () => {
		const { node, fired } = mount(
			"richText",
			{
				blocks: [
					[0, ["Run this:"]],
					[1, "let x = 1", "js"],
				],
			},
			["copyCode"],
		)
		expect(part(node, "codeLanguage").textContent).toBe("js")
		expect(node.querySelector("[data-syntax=keyword]")?.textContent).toBe("let")
		part<HTMLButtonElement>(node, "codeCopy").click()
		expect(fired).toEqual([["copyCode", { block: 1 }]])
	})

	it("draws no language pill for plain text and clips a block past 15 lines", () => {
		const long = Array.from({ length: 16 }, (_, line) => `line ${line}`).join("\n")
		const { node } = mount("richText", { blocks: [[1, long, ""]] })
		expect(part(node, "codeLanguage")).toBeNull()
		expect(part(node, "codeBlock").hasAttribute("data-collapsed")).toBe(true)
	})
})

describe("hz:progress spinner", () => {
	it("draws the loader's twelve strokes, no track, and stays an unvalued progressbar", () => {
		const { node } = mount("progress", { style: "spinner", indeterminate: true, label: "Loading" })
		expect(node.getAttribute("role")).toBe("progressbar")
		expect(node.getAttribute("aria-label")).toBe("Loading")
		expect(node.hasAttribute("aria-valuenow")).toBe(false)
		expect(part(node, "track").hidden).toBe(true)
		expect(part(node, "spinner").querySelectorAll("line")).toHaveLength(12)
	})
})

describe("hz:grid", () => {
	it("carries its columns and density as attributes", () => {
		const { node } = mount("grid", { columns: "3", density: "compact" })
		expect(node.dataset.columns).toBe("3")
		expect(node.dataset.density).toBe("compact")
	})
})
