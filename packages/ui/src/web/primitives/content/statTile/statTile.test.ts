// @vitest-environment happy-dom
/** Lane W2b: `hz:statTile`: value, delta, definition, the link, loading and empty. */
import { describe, expect, it } from "vitest"
import { create, type Primitive } from "../../../primitives.ts"
import type { Plain } from "../../define.ts"

const mount = (props: Readonly<Record<string, Plain>>) => {
	const primitive = create(document, "hz:statTile") as Primitive
	for (const [name, value] of Object.entries(props)) primitive.set(name, value)
	document.body.append(primitive.outer)
	return { primitive, node: primitive.outer }
}

const part = (node: Element, name: string) => node.querySelector<HTMLElement>(`[data-hz-part=${name}]`)

describe("hz:statTile", () => {
	it("draws the value, the delta with its arrow and tone, and the comparison", () => {
		const { node } = mount({
			label: "MRR",
			value: "$48.2k",
			delta: "4.1%",
			trend: "up",
			deltaTone: "success",
			comparison: "vs previous 30 days",
		})
		expect(part(node, "label")?.textContent).toBe("MRR")
		expect(part(node, "value")?.textContent).toBe("$48.2k")
		expect(part(node, "delta")?.querySelector("svg")).not.toBeNull()
		expect(part(node, "delta")?.textContent).toBe("4.1%")
		expect(node.dataset.deltaTone).toBe("success")
		expect(part(node, "comparison")?.textContent).toBe("vs previous 30 days")
		expect(node.hasAttribute("data-empty")).toBe(false)
		expect(part(node, "link")).toBeNull()
	})

	it("draws a flat delta without an arrow", () => {
		const { node } = mount({ label: "Seats", value: "12", delta: "0%" })
		expect(part(node, "delta")?.querySelector("svg")).toBeNull()
	})

	it("puts the definition behind a labelled button that describes it", () => {
		const { node } = mount({ label: "MRR", value: "$1", definition: "Monthly recurring revenue" })
		const term = part(node, "term")!
		expect(term.tagName).toBe("BUTTON")
		expect(term.textContent).toBe("MRR")
		const definition = document.getElementById(term.getAttribute("aria-describedby")!)
		expect(definition?.getAttribute("role")).toBe("tooltip")
		expect(definition?.textContent).toBe("Monthly recurring revenue")
	})

	it("links the whole tile, named after its label, as the outer node's own link", () => {
		const { node, primitive } = mount({ label: "MRR", value: "$1", href: "/billing" })
		const link = node.querySelector(":scope > a[href]")
		expect(link?.getAttribute("href")).toBe("/billing")
		expect(link?.getAttribute("aria-label")).toBe("MRR: details")
		expect(node.hasAttribute("data-linked")).toBe(true)
		primitive.set("href", null)
		expect(node.querySelector("a")).toBeNull()
	})

	it("is busy with skeletons while loading, and empty with a dash when there is no value", () => {
		const { node, primitive } = mount({ label: "MRR", loading: true })
		expect(node.getAttribute("aria-busy")).toBe("true")
		expect(node.hasAttribute("data-empty")).toBe(false)
		expect(part(node, "skeleton")?.getAttribute("data-motion")).toBe("loop")
		expect(part(node, "loadingText")?.textContent).toBe("Loading")
		primitive.set("loading", false)
		expect(node.hasAttribute("aria-busy")).toBe(false)
		expect(part(node, "loadingText")).toBeNull()
		expect(node.hasAttribute("data-empty")).toBe(true)
		expect(part(node, "value")?.textContent).toBe(String.fromCharCode(0x2014))
	})
})
