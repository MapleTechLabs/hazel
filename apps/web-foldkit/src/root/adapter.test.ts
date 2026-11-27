// @vitest-environment jsdom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { UiSchema } from "@effect/ui"
import { BrowserHost, Html } from "@effect/ui/html"
import { Effect, Layer, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { HOLE_ATTRIBUTE } from "../app/holes"
import { REGION_ATTRIBUTE } from "../app/view"
import { AdoptRegion } from "./foldkit"
import { Hole } from "./portal"

/** A frame with one slot, and optionally a child in a hole, as the shell draws them. */
const Message = UiSchema.TaggedEnum({ Toggled: {} })
const Frame = Html.component({
	name: "Frame",
	props: Schema.Struct({ withSlot: Schema.Boolean, withChild: Schema.Boolean }),
	model: Schema.Struct({}),
	message: Message,
}).make({
	init: () => ({}),
	update: ($) => $.model,
	view: (h) =>
		h.div.children(
			h.props.withSlot
				? h.div
						.key("slot")
						.attr("data-test", "slot")
						.onMount(AdoptRegion({ region: "page" }))
				: null,
			h.props.withChild
				? Hole(h, { hole: "dms", key: "k" }, [h.p.attr("data-test", "child").children("shell child")])
				: null,
		),
})

/** What the Foldkit host leaves in the document: its root with a region, and a page with a hole. */
const foldkitDom = () => {
	document.body.innerHTML = `<div data-foldkit-host hidden><div ${REGION_ATTRIBUTE}="page"><main data-test="page">a Foldkit page<div ${HOLE_ATTRIBUTE}="dms"></div></main></div></div><div id="root"></div>`
	return document.getElementById("root")!
}

const mount = (container: Element, props: { withSlot: boolean; withChild: boolean }) =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				yield* Layer.build(BrowserHost.mount(Frame, props, container))
				yield* Effect.sleep("10 millis")
				return {
					regionInSlot: document.querySelector('[data-test="slot"] > [data-test]') !== null,
					pageInSlot: document.querySelector('[data-test="slot"] [data-test="page"]') !== null,
					childInHole:
						document.querySelector(`[${HOLE_ATTRIBUTE}="dms"] [data-test="child"]`) !== null,
				}
			}),
		),
	)

beforeEach(() => {
	// jsdom draws no frames: a frame is the next task.
	globalThis.requestAnimationFrame = (callback) => {
		setTimeout(() => callback(0), 0)
		return 1
	}
	globalThis.cancelAnimationFrame = () => {}
})

afterEach(() => {
	document.body.innerHTML = ""
})

describe("the Foldkit adapter", () => {
	test("a slot takes its region from the host, and gives it back when it goes", async () => {
		const container = foldkitDom()
		const inside = await mount(container, { withSlot: true, withChild: false })
		expect(inside.pageInSlot).toBe(true)
		// The scope closed: the region is back in the host, where Foldkit still patches it.
		expect(document.querySelector(`[data-foldkit-host] > [${REGION_ATTRIBUTE}="page"]`)).not.toBeNull()
	})

	test("a child of the shell moves into the page's hole and leaves it when it unmounts", async () => {
		const container = foldkitDom()
		const inside = await mount(container, { withSlot: false, withChild: true })
		expect(inside.childInHole).toBe(true)
		expect(document.querySelector(`[${HOLE_ATTRIBUTE}="dms"] [data-test="child"]`)).toBeNull()
	})

	test("with no hole yet, the child waits hidden in its home", async () => {
		document.body.innerHTML = `<div id="root"></div>`
		const inside = await mount(document.getElementById("root")!, { withSlot: false, withChild: true })
		expect(inside.childInHole).toBe(false)
	})
})
