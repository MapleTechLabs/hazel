import { Schema } from "effect"
import { Runtime } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { beforeAll, describe, expect, it } from "vitest"

import { makeElementBridge } from "./bridge"
import { type Overlays, makeOverlays } from "./overlays"
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

const boot = (render: typeof view = view, overlays?: Overlays) => {
	const sent: Array<RuntimeToHost> = []
	const bridge = makeElementBridge({ mounts: new Set(), sendScroll: () => {} })
	const rune = makeRuneTarget({
		styles,
		bridge,
		env: { width: 800, height: 600, dark: false },
		send: (m) => sent.push(m),
		overlays,
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

	it("sends h.Tabindex as the tabindex attribute the host makes a Tab stop", async () => {
		const tabbable = (_: Model, h: HtmlBuilder<Message>): Html =>
			h.div([], [h.span([h.Tabindex(0), h.Role("link")], ["Home"])])
		const { handle, trees } = boot(tabbable)
		await settle()
		const span = elements(trees().at(-1)!.root).find((e) => e.tag === "span")!
		expect(span.attrs.tabindex).toBe("0")
		handle.dispose()
	})

	it("keeps an svg's <text> and its content in the icon body", async () => {
		const labelled = (_: Model, h: HtmlBuilder<Message>): Html =>
			h.svg(
				[h.Attribute("viewBox", "0 0 18 18")],
				[
					h.text(
						[
							h.Attribute("x", "9"),
							h.Attribute("text-anchor", "middle"),
							h.Attribute("font-size", "6"),
							h.Attribute("font-weight", "700"),
						],
						["G<F"],
					),
				],
			)
		const { handle, trees } = boot(labelled)
		await settle()
		const root = trees().at(-1)!.root
		expect(root.k === "svg" ? root.body : "").toBe(
			'<text x="9" text-anchor="middle" font-size="6" font-weight="700">G&lt;F</text>',
		)
		handle.dispose()
	})

	it("sends the overlays Mounts asked for and routes the host's dismiss back", async () => {
		const menu = (_: Model, h: HtmlBuilder<Message>): Html =>
			h.div(
				[],
				[
					h.button([h.Id("trigger")], ["Open"]),
					h.div([], [h.div([], ["Panel"])]),
					// A menu renders inside its own trigger.
					h.div([h.Id("outer")], [h.div([], ["Nested"])]),
				],
			)
		const overlays = makeOverlays()
		const { rune, handle, trees } = boot(menu, overlays)
		await settle()
		overlays.portal("r/1")
		overlays.modal("r/1")
		overlays.anchor("r/1/0", { triggerId: "trigger", side: "bottom", align: "start", gap: 4 })
		overlays.anchor("r/2/0", { triggerId: "outer", side: "top", align: "end", gap: 2 })
		let dismissed = 0
		overlays.onDismiss("r/1", () => dismissed++)
		await settle()
		// The trigger did not change: it goes as a reference, so only the overlay's nodes are here.
		const sentOverlays = elements(trees().at(-1)!.root).flatMap((n) => (n.ov === undefined ? [] : [n.ov]))
		expect(sentOverlays).toEqual([
			{ portal: 1 },
			{ anchor: { to: "r/0", side: "bottom", align: "start", gap: 4 }, modal: "r/1" },
			{ anchor: { to: "r/2", side: "top", align: "end", gap: 2 } },
		])
		rune.handleHostMessage({ t: "dismiss", path: "r/1" })
		expect(dismissed).toBe(1)
		handle.dispose()
	})

	it("shows an anchored panel its view hid until positioned", async () => {
		const tooltip = (_: Model, h: HtmlBuilder<Message>): Html =>
			h.div(
				[],
				[h.button([h.Id("tip-trigger")], ["?"]), h.div([h.Style({ visibility: "hidden" })], ["Tip"])],
			)
		const overlays = makeOverlays()
		const { handle, trees } = boot(tooltip, overlays)
		await settle()
		expect(elements(trees().at(-1)!.root).at(-1)?.st.visibility).toBe("hidden")
		overlays.anchor("r/1", { triggerId: "tip-trigger", side: "top", align: "center", gap: 10 })
		await settle()
		const panel = elements(trees().at(-1)!.root).find((n) => n.ov?.anchor !== undefined)
		expect(panel?.st.visibility).toBeUndefined()
		handle.dispose()
	})

	it("reuses an unchanged VNode's last result and keeps its handlers", async () => {
		// One VNode object across renders, as a lazy view returns.
		let shared: Html | undefined
		const reused = (model: Model, h: HtmlBuilder<Message>): Html => {
			shared ??= h.button([h.OnClick(Message.ClickedIncrement())], ["+"])
			return h.div([], [h.span([], [`${model.count}`]), shared])
		}
		const { rune, handle, trees } = boot(reused)
		await settle()
		const press = () => {
			const button = trees().at(-1)!
			const id = elements(button.root).find((e) => e.tag === "button")?.on.click
			// A reused button goes as a reference; its handler id is the one first sent.
			rune.handleHostMessage({ t: "event", seq: 1, id: id ?? firstId, type: "click", gen: button.gen })
		}
		const firstId = elements(trees().at(-1)!.root).find((e) => e.tag === "button")!.on.click!
		press()
		await settle()
		press()
		await settle()
		expect(texts(trees().at(-1)!.root)).toContain("2")
		handle.dispose()
	})

	it("re-resolves a reused VNode whose earlier sibling changed", async () => {
		let shared: Html | undefined
		const peers = (model: Model, h: HtmlBuilder<Message>): Html => {
			shared ??= h.span([h.Class("peer-data-[on=true]:font-bold")], ["after"])
			return h.div(
				[],
				[
					h.button(
						[
							h.Class("peer"),
							h.DataAttribute("on", String(model.count > 0)),
							h.OnClick(Message.ClickedIncrement()),
						],
						["+"],
					),
					shared,
				],
			)
		}
		const { rune, handle, trees } = boot(peers)
		await settle()
		const span = () => elements(trees().at(-1)!.root).find((e) => e.tag === "span")
		expect(span()?.st.fontWeight).toBeUndefined()
		// Unchanged since the first tree, the button may go as a reference: its handler id is stable.
		const button = elements(trees()[0]!.root).find((e) => e.tag === "button")!
		rune.handleHostMessage({ t: "event", seq: 1, id: button.on.click!, type: "click" })
		await settle()
		expect(span()?.st.fontWeight).toBe(700)
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
		// A press on a tree the runtime no longer keeps runs nothing rather than the newest handler.
		press(first.gen + 1000, 3)
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

	it("styles an svg from its class attribute and keeps its aspect-ratio mode and paint", async () => {
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
		// Classes first seen after boot compile just after the commit, which then goes out again.
		await settle()
		const tree = sent.findLast((m): m is Extract<RuntimeToHost, { t: "tree" }> => m.t === "tree")
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
