// @vitest-environment happy-dom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Renderer, UiSchema } from "@effect/ui"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { Hazel } from "../../../../vocabulary/index.ts"
import { openPanels } from "../../../focus/layers.ts"
import * as WebHost from "../../../host.ts"

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
const key = (target: EventTarget, name: string) =>
	target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }))

const items = [
	{ id: "a", kind: "image", name: "a.png", url: "https://example.com/a.png", width: 800, height: 600 },
	{ id: "b", kind: "image", name: "b.png", url: "https://example.com/b.png" },
	{ id: "c", kind: "video", name: "c.mp4", url: "https://example.com/c.mp4", duration: "0:12" },
] as const

const Msg = UiSchema.TaggedEnum({
	Opened: {},
	Dismissed: {},
	Changed: { index: Schema.Finite },
	Selected: { id: Schema.String },
})

/** The viewer as a screen holds it: open and the index in the Model, following `change`. */
const Viewer = Hazel.component({
	name: "Viewer",
	props: Schema.Struct({}),
	model: Schema.Struct({
		open: Schema.Boolean,
		index: Schema.Finite,
		dismissed: Schema.Finite,
		selected: Schema.Array(Schema.String),
	}),
	message: Msg,
}).make({
	init: () => ({ open: false, index: 1, dismissed: 0, selected: [] }),
	update: {
		Opened: ($) => $.evolve({ open: () => true }),
		Dismissed: ($) => $.evolve({ open: () => false, dismissed: (n) => n + 1 }),
		Changed: ($, { index }) => $.evolve({ index: () => index }),
		Selected: ($, { id }) => $.evolve({ selected: (all) => [...all, id] }),
	},
	view: (h, model) =>
		h.stack.children(
			h.lightbox
				.open(model.open)
				.items(items)
				.index(model.index)
				.entries([{ entries: [{ id: "download", label: "Download", icon: "download" }] }])
				.on("change", ({ index }) => Msg.Changed({ index }))
				.on("select", ({ id }) => Msg.Selected({ id }))
				.on("dismiss", Msg.Dismissed()),
		),
})

type Model = { readonly index: number; readonly dismissed: number; readonly selected: ReadonlyArray<string> }

const mount = <A>(
	test: (
		root: HTMLElement,
		app: { readonly send: (message: typeof Msg.Type) => void; readonly model: () => Model | undefined },
	) => Effect.Effect<A>,
) => {
	document.body.innerHTML = `<button id="opener">open</button>`
	const root = document.createElement("div")
	document.body.append(root)
	return Effect.gen(function* () {
		const app = yield* Renderer.mount(Viewer, {}, root)
		yield* Effect.promise(settle)
		return yield* test(root, app)
	}).pipe(Effect.provide(WebHost.layer()), Effect.scoped, Effect.runPromise)
}

describe("hz:lightbox on the web host", () => {
	it("opens modal on the view's index, steps with the keys and the buttons, reports change", () =>
		mount((root, app) =>
			Effect.gen(function* () {
				const stage = root.querySelector<HTMLDialogElement>("[data-hz=lightbox] > dialog")!
				expect(stage.hasAttribute("data-open")).toBe(false)
				document.getElementById("opener")!.focus()
				app.send(Msg.Opened())
				yield* Effect.promise(settle)
				expect(stage.hasAttribute("data-open")).toBe(true)
				expect(stage.getAttribute("aria-label")).toBe("Image gallery")
				expect(openPanels(document)).toEqual([stage])
				expect(document.documentElement.style.overflow).toBe("hidden")
				const viewport = stage.querySelector<HTMLElement>("[data-hz-part=viewport]")!
				expect(document.activeElement).toBe(viewport)

				const counter = stage.querySelector("[data-hz-part=counter]")!
				const live = stage.querySelector("[data-hz-part=live]")!
				expect(counter.textContent).toBe("2 of 3")
				expect(live.textContent).toBe("2 of 3. b.png")
				const slides = [...stage.querySelectorAll<HTMLElement>("[data-hz-part=slide]")]
				expect(slides[1]!.hasAttribute("data-active")).toBe(true)
				expect(slides[0]!.getAttribute("aria-hidden")).toBe("true")
				// The open slide and its neighbours hold their media; the video is a player.
				expect(slides.map((slide) => slide.querySelector("[data-hz-part=media]")?.tagName)).toEqual([
					"IMG",
					"IMG",
					"VIDEO",
				])

				key(viewport, "ArrowRight")
				yield* Effect.promise(settle)
				expect(app.model()?.index).toBe(2)
				expect(counter.textContent).toBe("3 of 3")
				const next = stage.querySelector<HTMLButtonElement>('[data-hz-part=step][data-side="next"]')!
				expect(next.getAttribute("aria-disabled")).toBe("true")
				// The video has no zoom.
				const zoomIn = stage.querySelector<HTMLElement>('[aria-label="Zoom in"]')!
				expect(zoomIn.getAttribute("aria-disabled")).toBe("true")

				key(viewport, "Home")
				yield* Effect.promise(settle)
				expect(app.model()?.index).toBe(0)
				stage.querySelector<HTMLButtonElement>('[data-hz-part=step][data-side="next"]')!.click()
				yield* Effect.promise(settle)
				expect(app.model()?.index).toBe(1)

				const thumbs = [...stage.querySelectorAll<HTMLButtonElement>("[data-hz-part=thumb]")]
				expect(thumbs.map((thumb) => thumb.getAttribute("aria-label"))).toEqual([
					"a.png",
					"b.png",
					"c.mp4",
				])
				expect(thumbs[1]!.getAttribute("aria-current")).toBe("true")
				thumbs[2]!.click()
				yield* Effect.promise(settle)
				expect(app.model()?.index).toBe(2)
				expect(thumbs[2]!.getAttribute("aria-current")).toBe("true")
				// Far from the open slide, the first image gives its media up.
				expect(slides[0]!.querySelector("[data-hz-part=media]")).toBeNull()
			}),
		))

	it("draws entries with an icon as toolbar buttons and the image's menu; Escape and Close ask to dismiss", () =>
		mount((root, app) =>
			Effect.gen(function* () {
				const opener = document.getElementById("opener")!
				opener.focus()
				app.send(Msg.Opened())
				yield* Effect.promise(settle)
				const stage = root.querySelector<HTMLDialogElement>("[data-hz=lightbox] > dialog")!
				const tools = [...stage.querySelectorAll<HTMLElement>("[data-hz-part=tool]")]
				expect(tools.map((tool) => tool.getAttribute("aria-label"))).toEqual([
					"Zoom out",
					"Zoom in",
					"Download",
					"Close",
				])
				tools[2]!.click()
				yield* Effect.promise(settle)
				expect(app.model()?.selected).toEqual(["download"])

				const image = stage.querySelector<HTMLImageElement>("[data-hz-part=slide][data-active] img")!
				image.dispatchEvent(
					new MouseEvent("contextmenu", {
						bubbles: true,
						cancelable: true,
						clientX: 10,
						clientY: 10,
					}),
				)
				yield* Effect.promise(settle)
				const panel = stage.querySelector<HTMLElement>("[data-hz-part=menu] > [role=menu]")!
				expect(panel.hasAttribute("data-open")).toBe(true)
				const item = panel.querySelector<HTMLElement>("[role=menuitem]")!
				expect(item.textContent).toBe("Download")
				// Escape closes the menu first, not the viewer.
				key(item, "Escape")
				yield* Effect.promise(settle)
				expect(panel.hasAttribute("data-open")).toBe(false)
				expect(app.model()?.dismissed).toBe(0)

				key(stage.querySelector("[data-hz-part=viewport]")!, "Escape")
				yield* Effect.promise(settle)
				expect(app.model()?.dismissed).toBe(1)
				expect(stage.hasAttribute("data-open")).toBe(false)
				expect(document.activeElement).toBe(opener)
				expect(document.documentElement.style.overflow).toBe("")

				app.send(Msg.Opened())
				yield* Effect.promise(settle)
				tools[3]!.click()
				yield* Effect.promise(settle)
				expect(app.model()?.dismissed).toBe(2)
			}),
		))
})
