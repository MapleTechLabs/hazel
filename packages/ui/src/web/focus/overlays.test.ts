// @vitest-environment happy-dom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Renderer, UiSchema } from "@effect/ui"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { GifPicker } from "../../extensions/GifPicker.ts"
import { Hazel } from "../../vocabulary/index.ts"
import { missingWebExtensions } from "../extensions.ts"
import * as WebHost from "../host.ts"
import { openPanels } from "./layers.ts"

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const key = (target: EventTarget, name: string, init: KeyboardEventInit = {}) =>
	target.dispatchEvent(
		new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }),
	)

const container = () => {
	document.body.innerHTML = `<button id="opener">open</button>`
	const element = document.createElement("div")
	document.body.append(element)
	return element
}

const Msg = UiSchema.TaggedEnum({
	Opened: {},
	Dismissed: {},
	Selected: { id: Schema.String },
	Picked: { emoji: Schema.String },
})

/** A screen with one of each controlled overlay, all opened and closed by the Model. */
const Overlays = Hazel.component({
	name: "Overlays",
	props: Schema.Struct({}),
	model: Schema.Struct({
		open: Schema.Boolean,
		dismissed: Schema.Finite,
		selected: Schema.Array(Schema.String),
	}),
	message: Msg,
}).make({
	init: () => ({ open: false, dismissed: 0, selected: [] }),
	update: {
		Opened: ($) => $.evolve({ open: () => true }),
		Dismissed: ($) => $.evolve({ open: () => false, dismissed: (n) => n + 1 }),
		Selected: ($, { id }) => $.evolve({ selected: (all) => [...all, id] }),
		Picked: ($, { emoji }) => $.evolve({ open: () => false, selected: (all) => [...all, emoji] }),
	},
	view: (h, model) =>
		h.stack.children(
			h.dialog
				.open(model.open)
				.title("Rename")
				.description("Pick a name")
				.on("dismiss", Msg.Dismissed())
				.children(h.textField.label("Name"), h.textField.label("Topic")),
			h.menu
				.label("Options")
				.entries([
					{
						entries: [
							{ id: "copy", label: "Copy" },
							{ id: "off", label: "Off", disabled: true },
							{
								id: "notify",
								label: "Notifications",
								entries: [
									{ id: "all", label: "All" },
									{ id: "none", label: "None" },
								],
							},
						],
					},
				])
				.on("select", ({ id }) => Msg.Selected({ id })),
			h.tooltip.label("Pin message").children(h.textField.label("Pinned")),
			h.toast.open(true).tone("danger").title("Failed"),
		),
})

interface App {
	readonly send: (message: typeof Msg.Type) => void
	readonly model: () => { readonly dismissed: number; readonly selected: ReadonlyArray<string> } | undefined
}

const mountOverlays = <A>(test: (root: HTMLElement, app: App) => Effect.Effect<A, never, Hazel.Host>) => {
	const root = container()
	return Effect.gen(function* () {
		const app = yield* Renderer.mount(Overlays, {}, root)
		yield* Effect.promise(settle)
		return yield* test(root, app)
	}).pipe(Effect.provide(WebHost.layer()), Effect.scoped, Effect.runPromise)
}

describe("overlay primitives on the web host", () => {
	it("dialog: opens modal with focus in its content, traps Tab, asks to close on Escape, returns focus", () =>
		mountOverlays((root, app) =>
			Effect.gen(function* () {
				const opener = document.getElementById("opener")!
				const panel = root.querySelector<HTMLDialogElement>(
					"[data-hz=dialog] > dialog[data-hz-part=panel]",
				)!
				expect(panel.hasAttribute("data-open")).toBe(false)
				opener.focus()
				app.send(Msg.Opened())
				yield* Effect.promise(settle)
				expect(panel.hasAttribute("data-open")).toBe(true)
				expect(panel.getAttribute("aria-labelledby")).toBe(panel.querySelector("h2")?.id)
				expect(panel.getAttribute("aria-describedby")).toBe(panel.querySelector("p")?.id)
				const [name, topic] = [...panel.querySelectorAll("input")]
				expect(document.activeElement).toBe(name)
				topic!.focus()
				key(topic!, "Tab")
				expect(document.activeElement).toBe(name)

				key(name!, "Escape")
				yield* Effect.promise(settle)
				expect(app.model()?.dismissed).toBe(1)
				expect(panel.hasAttribute("data-open")).toBe(false)
				expect(document.activeElement).toBe(opener)
				expect(openPanels(document)).toEqual([])
			}),
		))

	it("menu: opens from its button, moves with arrows past disabled entries, opens a submenu, reports the pick", () =>
		mountOverlays((root, app) =>
			Effect.gen(function* () {
				const menu = root.querySelector("[data-hz=menu]")!
				const button = menu.querySelector<HTMLButtonElement>(":scope > [data-hz-part=button]")!
				const [panel, submenu] = [
					...menu.querySelectorAll<HTMLElement>(":scope > [data-hz-part=panel]"),
				]
				expect(button.textContent).toBe("Options")
				expect(button.getAttribute("aria-haspopup")).toBe("menu")
				expect(panel!.getAttribute("aria-label")).toBe("Options")

				button.focus()
				button.click()
				yield* Effect.promise(settle)
				expect(button.getAttribute("aria-expanded")).toBe("true")
				const items = [...panel!.querySelectorAll<HTMLElement>("[role=menuitem]")]
				expect(items.map((item) => item.textContent)).toEqual(["Copy", "Off", "Notifications"])
				expect(document.activeElement).toBe(items[0])
				key(items[0]!, "ArrowDown")
				expect(document.activeElement).toBe(items[2])
				expect(items[2]!.getAttribute("aria-haspopup")).toBe("menu")

				key(items[2]!, "ArrowRight")
				expect(items[2]!.getAttribute("aria-expanded")).toBe("true")
				const leaves = [...submenu!.querySelectorAll<HTMLElement>("[role=menuitem]")]
				expect(leaves.map((leaf) => leaf.textContent)).toEqual(["All", "None"])
				expect(document.activeElement).toBe(leaves[0])
				key(leaves[0]!, "ArrowLeft")
				expect(document.activeElement).toBe(items[2])
				key(items[2]!, "Enter")
				key(document.activeElement!, "End")
				key(document.activeElement!, "Enter")
				yield* Effect.promise(settle)
				expect(app.model()?.selected).toEqual(["none"])
				expect(panel!.hasAttribute("data-open")).toBe(false)
				expect(document.activeElement).toBe(button)

				// Escape closes it and returns focus to the button too.
				key(button, "ArrowDown")
				yield* Effect.promise(settle)
				expect(panel!.hasAttribute("data-open")).toBe(true)
				key(document.activeElement!, "Escape")
				expect(panel!.hasAttribute("data-open")).toBe(false)
				expect(document.activeElement).toBe(button)
			}),
		))

	it("tooltip describes its trigger; toast is an alert for danger with a dismiss button", () =>
		mountOverlays((root) =>
			Effect.gen(function* () {
				const tooltip = root.querySelector("[data-hz=tooltip]")!
				const bubble = tooltip.querySelector("[role=tooltip]")!
				expect(bubble.textContent).toBe("Pin message")
				expect(tooltip.querySelector("input")?.getAttribute("aria-describedby")).toBe(bubble.id)

				const toast = root.querySelector("[data-hz=toast]")!
				expect(toast.getAttribute("data-tone")).toBe("danger")
				const panel = toast.querySelector("[data-hz-part=panel]")!
				expect(panel.getAttribute("role")).toBe("alert")
				expect(panel.hasAttribute("data-open")).toBe(true)
				expect(panel.querySelector("[data-hz-part=close]")?.getAttribute("aria-label")).toBe(
					"Dismiss",
				)
			}),
		))

	it("measure: the web host's command returns a node's viewport rect", () =>
		mountOverlays((root) =>
			Effect.gen(function* () {
				const host = yield* Hazel.Host
				const rect = yield* host.measure(root.querySelector("[data-hz=menu]")!)
				expect(Object.keys(rect).sort()).toEqual(["height", "width", "x", "y"])
				const detached = yield* host.measure(document.createElement("div"))
				expect(detached).toEqual({ x: 0, y: 0, width: 0, height: 0 })
			}),
		))
})

const PickerMsg = UiSchema.TaggedEnum({ Picked: { emoji: Schema.String }, Dismissed: {} })
const Picker = Hazel.component({
	name: "Picker",
	props: Schema.Struct({}),
	model: Schema.Struct({ open: Schema.Boolean, picked: Schema.Array(Schema.String) }),
	message: PickerMsg,
}).make({
	init: () => ({ open: true, picked: [] }),
	update: {
		Picked: ($, { emoji }) => $.evolve({ open: () => false, picked: (all) => [...all, emoji] }),
		Dismissed: ($) => $.evolve({ open: () => false }),
	},
	view: (h, model) =>
		h.emojiPicker
			.open(model.open)
			.on("select", ({ emoji }) => PickerMsg.Picked({ emoji }))
			.on("dismiss", PickerMsg.Dismissed()),
})

describe("emoji and GIF pickers", () => {
	it("emojiPicker: focuses its search, narrows the grid, picks with Enter", async () => {
		const root = container()
		await Effect.gen(function* () {
			const app = yield* Renderer.mount(Picker, {}, root)
			yield* Effect.promise(settle)
			const search = root.querySelector<HTMLInputElement>("[data-hz-part=search]")!
			expect(document.activeElement).toBe(search)
			search.value = "pizza"
			search.dispatchEvent(new Event("input", { bubbles: true }))
			const shown = [...root.querySelectorAll("[data-hz-part=emoji]")].map((b) =>
				b.getAttribute("aria-label"),
			)
			expect(shown).toEqual(["pizza"])
			key(search, "Enter")
			yield* Effect.promise(settle)
			expect(app.model()?.picked).toEqual(["🍕"])
			expect(root.querySelector("[data-hz-part=panel]")?.hasAttribute("data-open")).toBe(false)
		}).pipe(Effect.provide(WebHost.layer()), Effect.scoped, Effect.runPromise)
	})

	it("emojiPicker: draws the screen's categories, custom images, tag search and the hovered footer", async () => {
		const root = container()
		const Custom = Hazel.component({
			name: "Custom",
			props: Schema.Struct({}),
			model: Schema.Struct({ picked: Schema.Array(Schema.String) }),
			message: PickerMsg,
		}).make({
			init: () => ({ picked: [] }),
			update: {
				Picked: ($, { emoji }) => $.evolve({ picked: (all) => [...all, emoji] }),
				Dismissed: ($) => $.model,
			},
			view: (h) =>
				h.emojiPicker
					.open(true)
					.categories([
						{
							label: "Custom",
							emojis: [
								{ emoji: ":parrot:", name: "parrot", image: "https://emoji/parrot.gif" },
							],
						},
						{
							label: "Smileys & emotion",
							emojis: [
								{ emoji: "😄", name: "grinning face with smiling eyes", keywords: ["smile"] },
								{ emoji: "🙂", name: "slightly smiling face", keywords: ["smile"] },
							],
						},
					])
					.on("select", ({ emoji }) => PickerMsg.Picked({ emoji })),
		})
		await Effect.gen(function* () {
			const app = yield* Renderer.mount(Custom, {}, root)
			yield* Effect.promise(settle)
			const cells = () => [...root.querySelectorAll<HTMLElement>("[data-hz-part=emoji]")]
			expect(cells()[0]?.querySelector("img")?.getAttribute("src")).toBe("https://emoji/parrot.gif")
			expect(root.querySelector("[data-hz-part=footerHint]")?.textContent).toBe("Pick an emoji")
			cells()[0]!.dispatchEvent(new Event("pointerover", { bubbles: true }))
			expect(root.querySelector("[data-hz-part=footerLabel]")?.textContent).toBe("parrot")
			const search = root.querySelector<HTMLInputElement>("[data-hz-part=search]")!
			search.value = "smile"
			search.dispatchEvent(new Event("input", { bubbles: true }))
			// "smiling" is in neither name, so both match by their tag, in order.
			expect(cells().map((cell) => cell.getAttribute("aria-label"))).toEqual([
				"grinning face with smiling eyes",
				"slightly smiling face",
			])
			cells()[0]!.click()
			yield* Effect.promise(settle)
			expect(app.model()?.picked).toEqual(["😄"])
		}).pipe(Effect.provide(WebHost.layer()), Effect.scoped, Effect.runPromise)
	})

	it("GifPicker is registered on the web and draws the screen's results, chips and pager", async () => {
		expect(missingWebExtensions([GifPicker])).toEqual([])
		const root = container()
		const GifMsg = UiSchema.TaggedEnum({
			Selected: { url: Schema.String },
			Queried: { text: Schema.String },
			Chose: { query: Schema.String },
		})
		const cat = {
			url: "https://gif/hd.gif",
			still: "https://gif/sm.jpg",
			animated: "https://gif/sm.webp",
			title: "cat",
			width: 200,
			height: 150,
		}
		const Gifs = Hazel.component({
			name: "Gifs",
			props: Schema.Struct({}),
			model: Schema.Struct({ events: Schema.Array(Schema.String) }),
			message: GifMsg,
		}).make({
			init: () => ({ events: [] }),
			update: {
				Selected: ($, { url }) => $.evolve({ events: (all) => [...all, `select ${url}`] }),
				Queried: ($, { text }) => $.evolve({ events: (all) => [...all, `query ${text}`] }),
				Chose: ($, { query }) => $.evolve({ events: (all) => [...all, `category ${query}`] }),
			},
			view: (h) =>
				h
					.extension(GifPicker, {
						open: true,
						gifs: [cat],
						categories: [{ label: "Happy", query: "happy" }],
						status: "ready",
						paging: "loading",
					})
					.on("select", ({ url }) => GifMsg.Selected({ url }))
					.on("query", ({ text }) => GifMsg.Queried({ text }))
					.on("category", ({ query }) => GifMsg.Chose({ query })),
		})
		await Effect.gen(function* () {
			const app = yield* Renderer.mount(Gifs, {}, root)
			yield* Effect.promise(settle)
			const tile = root.querySelector<HTMLButtonElement>("[data-hz-part=gif]")!
			expect(tile.getAttribute("aria-label")).toBe("cat")
			expect(tile.querySelector("img")?.getAttribute("src")).toBe(cat.still)
			tile.dispatchEvent(new Event("pointerenter"))
			expect(tile.querySelector("img")?.getAttribute("src")).toBe(cat.animated)
			expect(root.querySelector("[data-hz-part=gifPager] [data-hz-spinner]")).not.toBeNull()
			expect(root.querySelector("[data-hz-part=gifAttribution]")?.textContent).toBe("Powered by KLIPY")
			root.querySelector<HTMLButtonElement>("[data-hz-part=gifChip]")!.click()
			tile.click()
			yield* Effect.promise(settle)
			expect(app.model()?.events).toEqual(["category happy", `select ${cat.url}`])
		}).pipe(Effect.provide(WebHost.layer()), Effect.scoped, Effect.runPromise)
	})
})
