// @vitest-environment happy-dom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Renderer, UiSchema } from "@effect/ui"
import { Effect, Schema } from "effect"
import { expect, it } from "vitest"
import { Hazel } from "../../vocabulary/index.ts"
import * as WebHost from "../host.ts"

const entries = [{ entries: [{ id: "copy", label: "Copy" }] }]
const Msg = UiSchema.TaggedEnum({ Selected: { id: Schema.String } })

/** A menu and a context menu that never open (`overlay-styles-on-create`). */
const Closed = Hazel.component({
	name: "Closed",
	props: Schema.Struct({}),
	model: Schema.Struct({}),
	message: Msg,
}).make({
	init: () => ({}),
	update: { Selected: ($) => $ },
	view: (h) =>
		h.stack.children(
			h.menu.label("Options").entries(entries),
			h.contextMenu.entries(entries).children(h.text.children("Row")),
		),
})

// Its own file: the overlay CSS is installed once per document, so no other overlay may run first.
it("menu and contextMenu install the closed-panel CSS when created, before any open", () =>
	Effect.gen(function* () {
		const root = document.createElement("div")
		document.body.append(root)
		yield* Renderer.mount(Closed, {}, root)
		yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)))
		expect(document.head.querySelector("style[data-hz-overlays]")).not.toBeNull()
		const panels = [...root.querySelectorAll<HTMLElement>("[data-hz-part=panel]")]
		expect(panels.length).toBe(4)
		for (const panel of panels) {
			expect(panel.hasAttribute("data-open")).toBe(false)
			expect(getComputedStyle(panel).display).toBe("none")
		}
	}).pipe(Effect.provide(WebHost.layer()), Effect.scoped, Effect.runPromise))
