import { Schema } from "effect"
import { Runtime } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { beforeAll, describe, expect, it } from "vitest"

import { makeElementBridge } from "./bridge"
import { StyleResolver } from "./style"
import { makeRuneTarget } from "./target"
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

const boot = () => {
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
			view,
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
})
