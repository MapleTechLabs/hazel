import { Schema } from "effect"
import { Runtime } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { makeElementBridge } from "./bridge"
import { StyleResolver } from "./style"
import { makeRuneTarget, markerText } from "./target"
import type { CommitStats, RuntimeToHost, WireNode } from "./wire"

const Message = defineMessageUnion({ Added: {} })
type Message = typeof Message.Type

const Model = Schema.Struct({ count: Schema.Number })
type Model = typeof Model.Type

type View = (model: Model, h: HtmlBuilder<Message>) => Html
type Element = Extract<WireNode, { k: "e" }>

let styles: StyleResolver
beforeAll(async () => {
	styles = await StyleResolver.load(new URL("../test/styles.css", import.meta.url).pathname)
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const elements = (node: WireNode): Array<Element> =>
	node.k === "e" ? [node, ...node.c.flatMap(elements)] : []

const texts = (node: WireNode): Array<string> =>
	node.k === "t" ? [node.s] : node.k === "e" ? node.c.flatMap(texts) : []

/** The marker the serializer drew for a list item: its keyed last child. */
const markerOf = (li: Element): Element | undefined => {
	const last = li.c.at(-1)
	return last?.k === "e" && last.key === "list-marker" ? last : undefined
}

/** An item's name: its first text child (a nested list in it may be sent as a reference). */
const itemText = (li: Element) => {
	const first = li.c[0]
	return first?.k === "t" ? first.s : ""
}

/** How many elements a tree spells out, rather than refers to by hash: what the host is sent. */
const spelledOut = (node: WireNode): number =>
	node.k === "e" ? 1 + node.c.reduce((sum, c) => sum + spelledOut(c), 0) : 0

const boot = (view: View) => {
	const sent: Array<RuntimeToHost> = []
	const stats: Array<CommitStats> = []
	const rune = makeRuneTarget({
		styles,
		bridge: makeElementBridge({ mounts: new Set(), send: () => {} }),
		env: { width: 800, height: 600, dark: false },
		send: (m) => sent.push(m),
		onStats: (s) => stats.push(s),
	})
	const handle = Runtime.embed(
		Runtime.makeElement({
			Model,
			init: () => ({ model: { count: 0 } }),
			update: (model: Model, message: Message) =>
				Message.match(message, { Added: () => ({ model: { count: model.count + 1 } }) }),
			view,
			renderTarget: rune.target,
		}),
	)
	const trees = () => sent.filter((m): m is Extract<RuntimeToHost, { t: "tree" }> => m.t === "tree")
	/** Each list item as last sent, by its text: a later tree refers to an unchanged one by hash. */
	const items = () => {
		const latest = new Map<string, Element>()
		for (const tree of trees())
			for (const e of elements(tree.root)) if (e.tag === "li") latest.set(itemText(e), e)
		return latest
	}
	const add = async () => {
		const button = trees()
			.flatMap((tree) => elements(tree.root))
			.findLast((e) => e.tag === "button")!
		rune.handleHostMessage({
			t: "event",
			seq: trees().length,
			gen: trees().at(-1)!.gen,
			id: button.on.click!,
			type: "click",
		})
		await settle()
	}
	return { handle, trees, items, stats, add }
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

describe("list markers", () => {
	it("writes each list-style-type's marker as CSS counts it", () => {
		expect(markerText("disc", 1)).toBe("•")
		expect(markerText("circle", 1)).toBe("◦")
		expect(markerText("square", 1)).toBe("▪")
		expect(markerText("decimal", 12)).toBe("12.")
		expect(markerText("decimal", 0)).toBe("0.")
		expect([1, 26, 27, 52, 703].map((n) => markerText("lower-alpha", n))).toEqual([
			"a.",
			"z.",
			"aa.",
			"az.",
			"aaa.",
		])
		expect(markerText("upper-alpha", 28)).toBe("AB.")
		expect([4, 9, 14, 40, 1994, 3999].map((n) => markerText("upper-roman", n))).toEqual([
			"IV.",
			"IX.",
			"XIV.",
			"XL.",
			"MCMXCIV.",
			"MMMCMXCIX.",
		])
		expect(markerText("lower-roman", 4)).toBe("iv.")
		// Past what the system counts, a list falls back to decimal, as CSS does.
		expect(markerText("lower-roman", 4000)).toBe("4000.")
		expect(markerText("lower-alpha", 0)).toBe("0.")
	})

	it("numbers a nested list on its own counter with its own type", async () => {
		const { handle, items } = boot((_model, h) =>
			h.ol(
				[h.Class("list-decimal")],
				[
					h.li([], ["one"]),
					h.li(
						[],
						["two", h.ul([h.Class("list-disc")], [h.li([], ["inner a"]), h.li([], ["inner b"])])],
					),
					h.li([], ["three"]),
				],
			),
		)
		await settle()
		const marker = (text: string) => texts(markerOf(items().get(text)!)!).join("")
		expect(marker("one")).toBe("1.")
		expect(marker("two")).toBe("2.")
		expect(marker("three")).toBe("3.")
		expect(marker("inner a")).toBe("•")
		expect(marker("inner b")).toBe("•")
		handle.dispose()
	})

	it("counts only list items: a text run or another element between them takes no number", async () => {
		const { handle, items } = boot((_model, h) =>
			h.ol(
				[h.Class("list-decimal"), h.Attribute("start", "10")],
				[h.li([], ["first"]), h.div([], ["not an item"]), h.li([], ["second"])],
			),
		)
		await settle()
		expect(texts(markerOf(items().get("first")!)!).join("")).toBe("10.")
		expect(texts(markerOf(items().get("second")!)!).join("")).toBe("11.")
		handle.dispose()
	})

	it("sizes and places the marker by the item's font", async () => {
		const { handle, items } = boot((_model, h) =>
			h.ul([h.Class("list-disc text-[20px]")], [h.li([], ["big"])]),
		)
		await settle()
		const marker = markerOf(items().get("big")!)!
		expect(marker.st).toMatchObject({ absolute: [-60, 0, null, null], w: 60, pad: [0, 6, 0, 0] })
		expect(marker.st.textAlign).toBe("right")
		handle.dispose()
	})

	it("adds no marker to items of an unstyled or list-none list", async () => {
		const { handle, items } = boot((_model, h) =>
			h.div(
				[],
				[
					h.ul([], [h.li([], ["bare"])]),
					h.ul([h.Class("list-disc")], [h.li([h.Class("list-none")], ["opted out"])]),
				],
			),
		)
		await settle()
		expect(markerOf(items().get("bare")!)).toBeUndefined()
		expect(markerOf(items().get("opted out")!)).toBeUndefined()
		handle.dispose()
	})

	describe("performance", () => {
		const LONG = 400

		it("resends nothing of an unchanged list when something beside it changes", async () => {
			const { handle, trees, stats, add } = boot((model, h) =>
				h.div(
					[],
					[
						h.button([h.OnClick(Message.Added())], [`${model.count}`]),
						h.ol(
							[h.Class("list-decimal")],
							range(LONG).map((i) => h.li([], [`item ${i}`])),
						),
					],
				),
			)
			await settle()
			await add()
			const root = trees().at(-1)!.root
			const list = root.k === "e" ? root.c[1] : undefined
			// The whole list, markers included, is one reference to what the host holds.
			expect(list).toEqual({ k: "r", h: expect.any(String) })
			// Sent: the root and the button; the list rides along by hash.
			expect(spelledOut(root)).toBeLessThan(5)
			expect(stats.at(-1)!.reusedSubtrees).toBeGreaterThan(0)
			handle.dispose()
		})

		it("appending an item sends that item alone, numbered after the rest", async () => {
			const { handle, trees, items, add } = boot((model, h) =>
				h.div(
					[],
					[
						h.button([h.OnClick(Message.Added())], ["add"]),
						h.ol(
							[h.Class("list-decimal")],
							range(LONG + model.count).map((i) => h.li([], [`item ${i}`])),
						),
					],
				),
			)
			await settle()
			await add()
			const root = trees().at(-1)!.root
			const list = root.k === "e" ? root.c[1]! : root
			expect(list.k).toBe("e")
			const sent = list.k === "e" ? list.c : []
			expect(sent.slice(0, LONG).every((c) => c.k === "r")).toBe(true)
			expect(sent[LONG]?.k).toBe("e")
			expect(texts(markerOf(items().get(`item ${LONG}`)!)!).join("")).toBe(`${LONG + 1}.`)
			// What is sent is the new item's size, not the list's length.
			expect(spelledOut(root)).toBeLessThan(8)
			handle.dispose()
		})

		it("prepending an item renumbers every item after it", async () => {
			const { handle, items, add } = boot((model, h) =>
				h.div(
					[],
					[
						h.button([h.OnClick(Message.Added())], ["add"]),
						h.ol(
							[h.Class("list-decimal")],
							[
								...range(model.count).map((i) => h.li([], [`new ${i}`])),
								...range(5).map((i) => h.li([], [`old ${i}`])),
							],
						),
					],
				),
			)
			await settle()
			await add()
			const marker = (text: string) => texts(markerOf(items().get(text)!)!).join("")
			expect(marker("new 0")).toBe("1.")
			expect(range(5).map((i) => marker(`old ${i}`))).toEqual(["2.", "3.", "4.", "5.", "6."])
			handle.dispose()
		})

		it("styles a long list's items once, not once per item", async () => {
			// SAFETY: `compute` is the resolver's uncached path; a spy counts how often it runs.
			const compute = vi.spyOn(styles as unknown as { compute: () => void }, "compute")
			const { handle } = boot((_model, h) =>
				h.ul(
					[h.Class("list-disc marker:text-[#ff0000]")],
					range(2000).map((i) => h.li([], [`item ${i}`])),
				),
			)
			await settle()
			// The list and one item style (twice: before and after its classes compiled), not 2000.
			expect(compute.mock.calls.length).toBeLessThan(10)
			compute.mockRestore()
			handle.dispose()
		})
	})
})
