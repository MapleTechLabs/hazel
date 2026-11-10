import { Effect, Option, Schema } from "effect"
import { Command, Runtime } from "foldkit"
import * as Dom from "foldkit/dom"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { beforeAll, describe, expect, it, vi } from "vitest"

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

const Clicked = defineMessageUnion({ Clicked: {} })
type Clicked = typeof Clicked.Type
type Focused = Readonly<{ _tag: "Completed"; outcome: string }>

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
	const bridge = makeElementBridge({ mounts: new Set(), send: () => {} })
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
	it("shows a dialog as a modal overlay, focuses inside it, and turns Escape into its cancel", async () => {
		const Shown = defineMessageUnion({ Shown: { isShown: Schema.Boolean }, Cancelled: {} })
		const ShowStatus = Command.define("ShowStatus", {
			messages: [Shown.Shown],
			execute: Dom.showDialog("#status", { isModal: true, focusSelector: "#status-field" }).pipe(
				Effect.catchTag("ElementNotFound", () => Effect.succeed(false)),
				Effect.map((isShown) => Shown.Shown({ isShown })),
			),
		})
		const sent: Array<RuntimeToHost> = []
		const overlays = makeOverlays()
		const rune = makeRuneTarget({
			styles,
			bridge: makeElementBridge({ mounts: new Set(), send: () => {} }),
			overlays,
			env: { width: 800, height: 600, dark: false },
			send: (m) => sent.push(m),
		})
		const handle = Runtime.embed(
			Runtime.makeElement({
				Model: Schema.Struct({ state: Schema.String }),
				init: () => ({ model: { state: "opening" }, commands: [ShowStatus()] }),
				update: (_model, message: typeof Shown.Type) => ({
					model: { state: message._tag === "Shown" ? `shown ${message.isShown}` : "cancelled" },
				}),
				view: (model, h) =>
					h.div(
						[],
						[
							h.span([], [model.state]),
							h.dialog(
								[h.Id("status"), h.OnCancelPreventDefault(Shown.Cancelled())],
								[h.button([], ["Close"]), h.input([h.Id("status-field")])],
							),
						],
					),
				renderTarget: rune.target,
			}),
		)
		await settle()
		// Unchanged subtrees go as references: the text is in the tree that changed it.
		const shows = (text: string) => sent.some((m) => m.t === "tree" && texts(m.root).includes(text))
		expect(shows("shown true")).toBe(true)
		expect(overlays.wireFor("r/1", () => undefined)).toEqual({ portal: 1, modal: "r/1" })
		expect(sent.filter((m) => m.t === "focus")).toEqual([{ t: "focus", key: "r/1/1/field" }])

		overlays.dismissed("r/1")
		await settle()
		expect(shows("cancelled")).toBe(true)
		handle.dispose()
	})

	it("bubbles a keydown through its chain, and Escape not prevented dismisses the topmost modal", async () => {
		const Keys = defineMessageUnion({ Inner: { key: Schema.String }, Outer: { key: Schema.String } })
		const sent: Array<RuntimeToHost> = []
		const overlays = makeOverlays()
		const rune = makeRuneTarget({
			styles,
			overlays,
			env: { width: 800, height: 600, dark: false },
			send: (m) => sent.push(m),
		})
		const seen: Array<string> = []
		const handle = Runtime.embed(
			Runtime.makeElement({
				Model: Schema.Struct({ n: Schema.Number }),
				init: () => ({ model: { n: 0 } }),
				update: (model, message: typeof Keys.Type) => {
					seen.push(`${message._tag} ${message.key}`)
					return { model: { n: model.n + 1 } }
				},
				view: (_model, h) =>
					h.div(
						[h.OnKeyDown((key) => Keys.Outer({ key }))],
						[
							h.div(
								[
									// Handles arrows itself (preventDefault); Escape is left to the overlay.
									h.OnKeyDownPreventDefault((key) =>
										key === "Escape" ? Option.none() : Option.some(Keys.Inner({ key })),
									),
								],
								["menu"],
							),
						],
					),
				renderTarget: rune.target,
			}),
		)
		await settle()
		const tree = sent.filter((m): m is Extract<RuntimeToHost, { t: "tree" }> => m.t === "tree").at(-1)!
		const [outer, inner] = elements(tree.root)
		let dismissed = 0
		overlays.modal("r")
		overlays.onDismiss("r", () => dismissed++)
		const key = (name: string) =>
			rune.handleHostMessage({
				t: "event",
				seq: 1,
				id: inner!.on.keydown!,
				chain: [outer!.on.keydown!],
				type: "keydown",
				key: name,
			})
		key("ArrowDown")
		key("Escape")
		await settle()
		expect(seen).toEqual(["Inner ArrowDown", "Outer ArrowDown", "Outer Escape"])
		expect(dismissed).toBe(1)
		handle.dispose()
	})

	it("picks a file for a clicked file input and hands it to the input's change handler", async () => {
		const Picked = defineMessageUnion({ PickedFiles: { names: Schema.Array(Schema.String) } })
		const sent: Array<RuntimeToHost> = []
		const bridge = makeElementBridge({ mounts: new Set(), send: () => {} })
		const rune = makeRuneTarget({
			styles,
			bridge,
			env: { width: 800, height: 600, dark: false },
			send: (m) => sent.push(m),
		})
		const seen: Array<string> = []
		const handle = Runtime.embed(
			Runtime.makeElement({
				Model: Schema.Struct({ n: Schema.Number }),
				init: () => ({ model: { n: 0 } }),
				update: (model, message: typeof Picked.Type) => {
					seen.push(...message.names)
					return { model: { n: model.n + 1 } }
				},
				view: (_model, h) =>
					h.div(
						[],
						[
							h.input([
								h.Type("file"),
								h.Attribute("accept", "image/*"),
								h.OnFileChange((files) =>
									Picked.PickedFiles({
										names: files.map((f) => `${f.name} ${f.type} ${f.size}`),
									}),
								),
							]),
						],
					),
				renderTarget: rune.target,
			}),
		)
		await settle()
		rune.click("r/0")
		expect(sent.filter((m) => m.t === "pickFile")).toEqual([
			{ t: "pickFile", path: "r/0", accept: "image/*" },
		])
		const file = new URL("../test/styles.css", import.meta.url).pathname
		await rune.filesPicked("r/0", [file])
		await settle()
		expect(seen).toEqual([`styles.css  ${(await import("node:fs")).statSync(file).size}`])
		handle.dispose()
	})

	it("moves an arrowed radio's group to the next radio, wrapping, and focuses it", async () => {
		const Chose = defineMessageUnion({ Chose: { value: Schema.String } })
		const sent: Array<RuntimeToHost> = []
		const bridge = makeElementBridge({ mounts: new Set(), send: () => {} })
		const rune = makeRuneTarget({
			styles,
			bridge,
			env: { width: 800, height: 600, dark: false },
			send: (m) => sent.push(m),
		})
		const chosen: Array<string> = []
		const radio = (h: HtmlBuilder<typeof Chose.Type>, value: string) =>
			h.input([
				h.Type("radio"),
				h.Name("mode"),
				h.Attribute("value", value),
				h.OnChange(() => Chose.Chose({ value })),
			])
		const handle = Runtime.embed(
			Runtime.makeElement({
				Model: Schema.Struct({ n: Schema.Number }),
				init: () => ({ model: { n: 0 } }),
				update: (model, message: typeof Chose.Type) => {
					chosen.push(message.value)
					return { model: { n: model.n + 1 } }
				},
				view: (_model, h) =>
					h.div(
						[],
						[radio(h, "light"), radio(h, "dark"), h.input([h.Type("radio"), h.Name("other")])],
					),
				renderTarget: rune.target,
			}),
		)
		await settle()
		rune.handleHostMessage({ t: "radio", path: "r/0", step: 1 })
		rune.handleHostMessage({ t: "radio", path: "r/1", step: 1 })
		await settle()
		expect(chosen).toEqual(["dark", "light"])
		expect(sent.filter((m) => m.t === "focus").map((m) => m.key)).toEqual(["r/1", "r/0"])
		handle.dispose()
	})

	it("activates a pressed label's control: focuses a field, toggles a checkbox", async () => {
		const Toggled = defineMessageUnion({ Toggled: {} })
		const sent: Array<RuntimeToHost> = []
		const bridge = makeElementBridge({ mounts: new Set(), send: () => {} })
		const rune = makeRuneTarget({
			styles,
			bridge,
			env: { width: 800, height: 600, dark: false },
			send: (m) => sent.push(m),
		})
		let toggles = 0
		const handle = Runtime.embed(
			Runtime.makeElement({
				Model: Schema.Struct({ n: Schema.Number }),
				init: () => ({ model: { n: 0 } }),
				update: (model, _message: typeof Toggled.Type) => {
					toggles++
					return { model: { n: model.n + 1 } }
				},
				view: (_model, h) =>
					h.div(
						[],
						[
							h.label([h.Attribute("for", "name")], ["Name"]),
							h.input([h.Id("name")]),
							h.label(
								[],
								[
									h.input([h.Type("checkbox"), h.OnChange(() => Toggled.Toggled())]),
									"Remember",
								],
							),
						],
					),
				renderTarget: rune.target,
			}),
		)
		await settle()
		rune.handleHostMessage({ t: "label", path: "r/0" })
		rune.handleHostMessage({ t: "label", path: "r/2" })
		await settle()
		expect(sent.filter((m) => m.t === "focus").map((m) => m.key)).toEqual(["r/1/field", "r/2/0"])
		expect(toggles).toBe(1)
		handle.dispose()
	})

	it("follows a clicked link's href unless its click handler prevented it", async () => {
		const followed: Array<string> = []
		const sent: Array<RuntimeToHost> = []
		const rune = makeRuneTarget({
			styles,
			env: { width: 800, height: 600, dark: false },
			send: (m) => sent.push(m),
			onLink: (href) => followed.push(href),
		})
		const handle = Runtime.embed(
			Runtime.makeElement({
				Model: Schema.Struct({ clicks: Schema.Number }),
				init: () => ({ model: { clicks: 0 } }),
				update: (model) => ({ model: { clicks: model.clicks + 1 } }),
				view: (_model, h) =>
					h.div(
						[],
						[
							h.a([h.Href("/settings"), h.OnClick(Clicked.Clicked())], ["Settings"]),
							h.a(
								[h.Href("/kept"), h.OnClick(Clicked.Clicked(), { defaultAction: "Prevent" })],
								["Kept"],
							),
						],
					),
				renderTarget: rune.target,
			}),
		)
		await settle()
		const tree = sent.filter((m): m is Extract<RuntimeToHost, { t: "tree" }> => m.t === "tree").at(-1)!
		const [settings, kept] = elements(tree.root).filter((e) => e.tag === "a")
		rune.handleHostMessage({
			t: "event",
			seq: 1,
			id: settings!.on.click!,
			type: "click",
			href: "/settings",
		})
		rune.handleHostMessage({ t: "event", seq: 2, id: kept!.on.click!, type: "click", href: "/kept" })
		expect(followed).toEqual(["/settings"])
		handle.dispose()
	})

	it("sends Dom.focus and Dom.scrollIntoView from a Command to the host, after the tree", async () => {
		const Focused = defineMessageUnion({ Completed: { outcome: Schema.String } })
		const FocusName = Command.define("FocusName", {
			messages: [Focused.Completed],
			execute: Effect.gen(function* () {
				yield* Dom.focus("#name")
				yield* Dom.scrollIntoView("#name", { block: "center" })
				yield* Dom.clickElement("#increment")
				yield* Dom.focus("#missing")
				return "focused"
			}).pipe(
				Effect.catchTag("ElementNotFound", ({ selector }) => Effect.succeed(`missing ${selector}`)),
				Effect.map((outcome) => Focused.Completed({ outcome })),
			),
		})
		const sent: Array<RuntimeToHost> = []
		const bridge = makeElementBridge({ mounts: new Set(), send: () => {} })
		const rune = makeRuneTarget({
			styles,
			bridge,
			env: { width: 800, height: 600, dark: false },
			send: (m) => sent.push(m),
		})
		const handle = Runtime.embed(
			Runtime.makeElement({
				Model: Schema.Struct({ outcome: Schema.String, clicks: Schema.Number }),
				init: () => ({ model: { outcome: "", clicks: 0 }, commands: [FocusName()] }),
				update: (model, message: Focused | Clicked) =>
					message._tag === "Completed"
						? { model: { ...model, outcome: message.outcome } }
						: { model: { ...model, clicks: model.clicks + 1 } },
				view: (model, h) =>
					h.div(
						[],
						[
							h.input([h.Id("name")]),
							h.button([h.Id("increment"), h.OnClick(Clicked.Clicked())], ["+"]),
							h.span([], [`${model.outcome} ${model.clicks}`]),
						],
					),
				renderTarget: rune.target,
			}),
		)
		await settle()
		const requests = sent.filter((m) => m.t !== "tree")
		expect(requests).toEqual([
			{ t: "focus", key: "r/0/field" },
			{ t: "reveal", path: "r/0", block: "center" },
		])
		expect(sent.findIndex((m) => m.t === "focus")).toBeGreaterThan(sent.findIndex((m) => m.t === "tree"))
		const last = sent.filter((m): m is Extract<RuntimeToHost, { t: "tree" }> => m.t === "tree").at(-1)!
		expect(texts(last.root).join("")).toContain("missing #missing 1")
		handle.dispose()
	})

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
		// The trigger did not change: it goes as a reference, so only the overlay's nodes are here.
		// Waits for that frame rather than a fixed delay, which a slow CI runner can outlast.
		const sentOverlays = await vi.waitFor(() => {
			const ovs = trees()
				.map((t) => elements(t.root).flatMap((n) => (n.ov === undefined ? [] : [n.ov])))
				.findLast((o) => o.length > 0)
			expect(ovs).toBeDefined()
			return ovs ?? []
		})
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

	it("sends nothing for a render that shows what the host already has", async () => {
		const stats: Array<{ skipped: boolean }> = []
		const sent: Array<RuntimeToHost> = []
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
				init: () => ({ model: { count: 0, name: "" } }),
				update,
				view,
				renderTarget: rune.target,
			}),
		)
		const trees = () => sent.filter((m): m is Extract<RuntimeToHost, { t: "tree" }> => m.t === "tree")
		await settle()
		const shown = trees().length
		const gen = trees().at(-1)!.gen
		// A scroll or layout report the view answers with the same tree.
		rune.refreshObserved()
		await settle()
		expect(trees().length).toBe(shown)
		expect(stats.at(-1)?.skipped).toBe(true)
		// A press on the tree still on screen reaches its handler.
		const button = trees()
			.flatMap((tree) => elements(tree.root))
			.find((e) => e.tag === "button")!
		rune.handleHostMessage({ t: "event", seq: 1, gen, id: button.on.click!, type: "click" })
		await settle()
		expect(trees().length).toBe(shown + 1)
		expect(texts(trees().at(-1)!.root)).toContain("1")
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

	it("draws the page's own theme over the host's appearance, and the host's without one", () => {
		const sent: Array<RuntimeToHost> = []
		let theme: "dark" | "light" | undefined = "dark"
		const rune = makeRuneTarget({
			styles,
			env: { width: 800, height: 600, dark: false },
			send: (m) => sent.push(m),
			theme: () => theme,
		})
		const pageBg = () =>
			sent.findLast((m): m is Extract<RuntimeToHost, { t: "tree" }> => m.t === "tree")?.page.bg
		const commit = (text: string) =>
			// SAFETY: commit only reads `body` and `title`; this VNode has the shape the serializer walks.
			rune.target.commit({
				title: "",
				body: { sel: "div", data: {}, children: [], text },
			} as unknown as Parameters<typeof rune.target.commit>[0])
		// The app chose Dark on a light Mac: dark.
		commit("a")
		const dark = pageBg()
		// It chose Light: light, whatever the host says.
		theme = "light"
		commit("b")
		const light = pageBg()
		expect(dark).not.toEqual(light)
		// No theme on the page: the host's appearance decides.
		theme = undefined
		rune.handleHostMessage({ t: "env", width: 800, height: 600, dark: true })
		commit("c")
		expect(pageBg()).toEqual(dark)
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
