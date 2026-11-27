// @vitest-environment happy-dom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Renderer, UiSchema } from "@effect/ui"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { Hazel } from "../../../../vocabulary/index.ts"
import * as WebHost from "../../../host.ts"

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

const Msg = UiSchema.TaggedEnum({ Loaded: {}, Dismissed: {}, Typed: {} })

/** A palette whose results arrive after the edit, as a debounced search's do. */
const Palette = Hazel.component({
	name: "Palette",
	props: Schema.Struct({}),
	model: Schema.Struct({ loaded: Schema.Boolean, typed: Schema.Finite }),
	message: Msg,
}).make({
	init: () => ({ loaded: false, typed: 0 }),
	update: {
		Loaded: ($) => $.evolve({ loaded: () => true }),
		Dismissed: ($) => $,
		// A new (still empty) result list per keystroke, so the edit draws before the results land.
		Typed: ($) => $.evolve({ typed: (n) => n + 1 }),
	},
	view: (h, model) =>
		h.stack.children(
			h.commandPalette
				.open(true)
				.groups(
					model.loaded
						? [
								{
									title: "Channels",
									items: [
										{ id: "design", label: "design" },
										{ id: "general", label: "general" },
									],
								},
							]
						: [{ title: `Searching ${model.typed}`, items: [] }],
				)
				.on("change", () => Msg.Typed())
				.on("dismiss", Msg.Dismissed()),
		),
})

describe("hz:commandPalette on the web host", () => {
	it("highlights the first result of an edit when the results land after it", () => {
		document.body.innerHTML = ""
		const root = document.createElement("div")
		document.body.append(root)
		return Effect.gen(function* () {
			const app = yield* Renderer.mount(Palette, {}, root)
			yield* Effect.promise(settle)
			const input = root.querySelector<HTMLInputElement>("[data-hz-part=input]")!
			input.value = "de"
			input.dispatchEvent(new Event("input", { bubbles: true }))
			yield* Effect.promise(settle)
			expect(root.querySelector("[data-highlighted]")).toBeNull()
			app.send(Msg.Loaded())
			yield* Effect.promise(settle)
			expect(root.querySelector("[data-highlighted]")?.textContent).toBe("design")
		}).pipe(Effect.provide(WebHost.layer()), Effect.scoped, Effect.runPromise)
	})
})
