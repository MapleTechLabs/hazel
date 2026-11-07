import { Schema } from "effect"
import { Runtime } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { beforeAll, describe, expect, it } from "vitest"

import { makeElementBridge } from "./bridge"
import { StyleResolver } from "./style"
import { htmlText, makeRuneTarget } from "./target"
import type { RuntimeToHost, WireNode } from "./wire"

const Message = defineMessageUnion({
	ClickedIncrement: {},
	ChangedName: { name: Schema.String },
})
type Message = typeof Message.Type

const Model = Schema.Struct({ count: Schema.Number, name: Schema.String })
type Model = typeof Model.Type

const update = (model: Model, message: Message) =>
	Message.match(message, {
		ClickedIncrement: () => ({ model: { ...model, count: model.count + 1 } }),
		ChangedName: ({ name }) => ({ model: { ...model, name } }),
	})

const view = (model: Model, h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("flex flex-col gap-2 p-4")],
		[
			h.p([h.Class("text-sm")], ["A static line that never changes"]),
			h.span([h.Class("font-semibold")], [`${model.count}`]),
			h.button([h.Class("rounded-md px-2"), h.OnClick(Message.ClickedIncrement())], ["+"]),
			h.input([h.Value(model.name), h.OnInput((name) => Message.ChangedName({ name }))]),
		],
	)

let styles: StyleResolver
beforeAll(async () => {
	styles = await StyleResolver.load(new URL("../test/styles.css", import.meta.url).pathname)
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const boot = (render: typeof view = view) => {
	const sent: Array<RuntimeToHost> = []
	const bridge = makeElementBridge({ mounts: new Set(), sendScroll: () => {} })
	const rune = makeRuneTarget({
		styles,
		bridge,
		env: { width: 800, height: 600, dark: false },
		send: (m) => sent.push(m),
	})
	const handle = Runtime.embed(
		Runtime.makeElement({
			Model,
			init: () => ({ model: { count: 0, name: "" } }),
			update,
			view: render,
			renderTarget: rune.target,
		}),
	)
	const trees = () => sent.filter((m): m is Extract<RuntimeToHost, { t: "tree" }> => m.t === "tree")
	return { rune, handle, trees }
}

const elements = (node: WireNode): Array<Extract<WireNode, { k: "e" }>> =>
	node.k === "e" ? [node, ...node.c.flatMap(elements)] : []

const texts = (node: WireNode): Array<string> =>
	node.k === "t" ? [node.s] : node.k === "e" ? node.c.flatMap(texts) : []

describe("makeRuneTarget", () => {
	it("sends resolved styles and routes host presses back as Messages", async () => {
		const { rune, handle, trees } = boot()
		await settle()
		const first = trees().at(-1)!
		const root = elements(first.root)[0]!
		expect(root.st).toMatchObject({ display: "flex", dir: "col", gapRow: 8, pad: [16, 16, 16, 16] })
		const button = elements(first.root).find((e) => e.tag === "button")!
		rune.handleHostMessage({ t: "event", seq: 1, id: button.on.click!, type: "click" })
		await settle()
		expect(texts(trees().at(-1)!.root)).toContain("1")
		handle.dispose()
	})

	it("keeps handler ids stable and sends unchanged subtrees by reference", async () => {
		const { rune, handle, trees } = boot()
		await settle()
		const before = elements(trees().at(-1)!.root).find((e) => e.tag === "button")!
		rune.handleHostMessage({ t: "event", seq: 1, id: before.on.click!, type: "click" })
		await settle()
		const after = trees().at(-1)!.root
		expect(after.k).toBe("e")
		const children = after.k === "e" ? after.c : []
		// The static paragraph and the button did not change: references, not resent nodes.
		expect(children[0]).toEqual({ k: "r", h: expect.any(String) })
		expect(children[2]).toEqual({ k: "r", h: before.h })
		handle.dispose()
	})

	it("acknowledges host events so a controlled input keeps the user's newest text", async () => {
		const { rune, handle, trees } = boot()
		await settle()
		const input = elements(trees().at(-1)!.root).find((e) => e.tag === "input")!
		rune.handleHostMessage({ t: "event", seq: 7, id: input.on.input!, type: "input", value: "Ada" })
		await settle()
		const latest = trees().at(-1)!
		expect(latest.ack).toBe(7)
		expect(elements(latest.root).find((e) => e.tag === "input")?.attrs.value).toBe("Ada")
		handle.dispose()
	})

	it("runs the handler of the tree the press was made on, not the one that replaced it", async () => {
		// The button's handler changes with the Model, as a Link that became an Unlink would.
		const stamped = (model: Model, h: HtmlBuilder<Message>): Html =>
			h.div(
				[],
				[
					h.button(
						[h.OnClick(Message.ChangedName({ name: model.name === "" ? "first" : "second" }))],
						[model.name],
					),
				],
			)
		const { rune, handle, trees } = boot(stamped)
		await settle()
		const first = trees().at(-1)!
		const button = elements(first.root).find((e) => e.tag === "button")!
		const press = (gen: number, seq: number) =>
			rune.handleHostMessage({ t: "event", seq, gen, id: button.on.click!, type: "click" })
		press(first.gen, 1)
		await settle()
		expect(texts(trees().at(-1)!.root)).toEqual(["first"])
		// A second press on the first tree's button runs that button's handler, not its replacement's.
		press(first.gen, 2)
		await settle()
		expect(trees().flatMap((tree) => texts(tree.root))).not.toContain("second")
		handle.dispose()
	})

	it("keeps a refresh's acknowledgement to the events its document shows", async () => {
		const { rune, handle, trees } = boot()
		await settle()
		const input = elements(trees().at(-1)!.root).find((e) => e.tag === "input")!
		rune.handleHostMessage({ t: "event", seq: 7, id: input.on.input!, type: "input", value: "Ada" })
		// A window resize lands before the edit's render: the old document goes out again.
		rune.handleHostMessage({ t: "env", width: 900, height: 600, dark: false })
		const refreshed = trees().at(-1)!
		expect(refreshed.ack).toBeLessThan(7)
		await settle()
		expect(trees().at(-1)!.ack).toBe(7)
		handle.dispose()
	})

	it("decodes numeric references in any case and keeps ones that name no code point", () => {
		expect(htmlText("&#X41;&#x42;&#67;")).toBe("ABC")
		expect(htmlText("a&#x110000;b")).toBe("a&#x110000;b")
	})

	it("styles an svg from its class attribute and keeps its aspect-ratio mode and paint", () => {
		const sent: Array<RuntimeToHost> = []
		const rune = makeRuneTarget({
			styles,
			env: { width: 800, height: 600, dark: false },
			send: (m) => sent.push(m),
		})
		const path = {
			sel: "path",
			data: { attrs: { d: "M0 0h1v1z", fill: "oklch(0.55 0.12 285)" } },
			children: [],
		}
		const svg = {
			sel: "svg",
			data: {
				attrs: {
					class: "absolute inset-0 size-full",
					viewBox: "0 0 8 8",
					preserveAspectRatio: "none",
				},
			},
			children: [path],
		}
		const body = { sel: "div", data: { class: { relative: true, "size-8": true } }, children: [svg] }
		// SAFETY: commit only reads `body` and `title`; this VNode has the shape the serializer walks.
		rune.target.commit({ title: "", body } as unknown as Parameters<typeof rune.target.commit>[0])
		const tree = sent.find((m): m is Extract<RuntimeToHost, { t: "tree" }> => m.t === "tree")
		const root = tree?.root
		const icon = root?.k === "e" ? root.c[0] : undefined
		expect(icon).toMatchObject({
			k: "svg",
			par: "none",
			st: { absolute: [0, 0, 0, 0], w: "full", h: "full" },
		})
		expect(icon?.k === "svg" ? icon.body : "").toMatch(/fill="#[0-9a-f]{6}"/)
	})

	it("still sends a tree whose inner HTML holds an out-of-range reference", () => {
		const sent: Array<RuntimeToHost> = []
		const rune = makeRuneTarget({
			styles,
			env: { width: 800, height: 600, dark: false },
			send: (m) => sent.push(m),
		})
		const body = { sel: "div", data: { props: { innerHTML: "x&#x110000;&#X41;" } }, children: [] }
		// SAFETY: commit only reads `body` and `title`; this VNode has the shape the serializer walks.
		rune.target.commit({ title: "", body } as unknown as Parameters<typeof rune.target.commit>[0])
		const tree = sent.find((m): m is Extract<RuntimeToHost, { t: "tree" }> => m.t === "tree")
		expect(tree === undefined ? [] : texts(tree.root)).toEqual(["x&#x110000;A"])
	})
})
