// @vitest-environment happy-dom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
// `hz:splitView` on the real web host: the edge's keys, drag and `resize` payloads, and its props.
// Widths and the compact sheet are layout, checked in Chromium (`test:web --tags splitView`).
import { Renderer, UiSchema } from "@effect/ui"
import * as View from "@effect/ui/View"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { component, HzBuilder, textParents } from "../../../../vocabulary/Hazel.ts"
import { tagName } from "../../../../vocabulary/spec.ts"
import * as WebHost from "../../../host.ts"

const Msg = UiSchema.TaggedEnum({ Resized: { width: Schema.Finite } })
const elements = { name: "hazel", textParents }

const text = (value: string) =>
	View.withContent(new HzBuilder<typeof Msg.Type, never, "text">(tagName("text")), [value])

const slot = (name: string, value: string) =>
	View.withNoTextContent(
		View.withFields(new HzBuilder<typeof Msg.Type, never, "slot">(tagName("slot")), { props: { name } }),
		[text(value)],
		elements,
	)

const Split = component({
	name: "SplitTest",
	props: Schema.Struct({ props: Schema.Record(Schema.String, Schema.Unknown) }),
	model: Schema.Struct({ widths: Schema.Array(Schema.Finite) }),
	message: Msg,
}).make({
	init: () => ({ widths: [] }),
	update: { Resized: ($, { width }) => $.evolve({ widths: (all) => [...all, width] }) },
	view: (h) =>
		View.withNoTextContent(
			View.withFields(new HzBuilder<typeof Msg.Type, never, "splitView">(tagName("splitView")), {
				props: h.props.props,
			}).on("resize", ((payload: { width: number }) => Msg.Resized({ width: payload.width })) as never),
			[slot("rail", "Rail"), slot("sidebar", "Sidebar"), slot("detail", "Thread"), text("Channel")],
			elements,
		) as never,
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const mounted = (
	props: Record<string, unknown>,
	body: (dom: HTMLElement, widths: () => ReadonlyArray<number>) => Promise<void>,
) => {
	document.body.innerHTML = ""
	const container = document.createElement("div")
	document.body.append(container)
	return Effect.gen(function* () {
		const app = yield* Renderer.mount(Split, { props }, container)
		yield* Effect.promise(settle)
		return yield* Effect.promise(() => body(container, () => app.model()?.widths ?? []))
	}).pipe(Effect.provide(WebHost.layer()), Effect.scoped, Effect.runPromise)
}

const parts = (dom: HTMLElement) => {
	const root = dom.querySelector<HTMLElement>('[data-hz="splitView"]')!
	const handle = root.querySelector<HTMLElement>('[data-hz-part="handle"]')!
	return { root, handle }
}

const key = (target: HTMLElement, name: string) =>
	target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }))

const pointer = (target: HTMLElement, type: string, clientX: number) =>
	target.dispatchEvent(
		new PointerEvent(type, { clientX, button: 0, pointerId: 1, bubbles: true, cancelable: true }),
	)

describe("hz:splitView on the web host", () => {
	it("maps its flags and width, and names the edge as a separator", () =>
		mounted({ sidebarCollapsed: true, resizable: true, detailWidth: 380 }, async (dom) => {
			const { root, handle } = parts(dom)
			expect(root.hasAttribute("data-sidebar-collapsed")).toBe(true)
			expect(root.hasAttribute("data-resizable")).toBe(true)
			expect(root.style.getPropertyValue("--hz-split-detail")).toBe("380px")
			expect(handle.getAttribute("role")).toBe("separator")
			expect(handle.getAttribute("aria-valuenow")).toBe("380")
			expect(handle.getAttribute("aria-label")).toBe("Resize panel")
			const slots = Array.from(root.children).map((child) => (child as HTMLElement).dataset.hzSlot)
			expect(slots).toEqual(expect.arrayContaining(["rail", "sidebar", "detail"]))
		}))

	it("opens at today's 480px and clamps a width below the narrowest panel", () =>
		mounted({ resizable: true, detailWidth: 100 }, async (dom) => {
			expect(parts(dom).handle.getAttribute("aria-valuenow")).toBe("320")
		}).then(() =>
			mounted({ resizable: true }, async (dom) => {
				expect(parts(dom).handle.getAttribute("aria-valuenow")).toBe("480")
			}),
		))

	it("grows on ArrowLeft and shrinks on ArrowRight by 24px, reporting each", () =>
		mounted({ resizable: true, detailWidth: 400 }, async (dom, widths) => {
			const { handle } = parts(dom)
			key(handle, "ArrowLeft")
			key(handle, "ArrowLeft")
			key(handle, "ArrowRight")
			key(handle, "Enter")
			await settle()
			expect(widths()).toEqual([424, 448, 424])
			expect(handle.getAttribute("aria-valuenow")).toBe("424")
		}))

	it("resizes live while dragged and reports once on release", () =>
		mounted({ resizable: true, detailWidth: 400 }, async (dom, widths) => {
			const { root, handle } = parts(dom)
			pointer(handle, "pointerdown", 800)
			expect(root.hasAttribute("data-resizing")).toBe(true)
			pointer(handle, "pointermove", 760)
			pointer(handle, "pointermove", 700)
			expect(root.style.getPropertyValue("--hz-split-detail")).toBe("500px")
			await settle()
			expect(widths()).toEqual([])
			pointer(handle, "pointerup", 700)
			await settle()
			expect(root.hasAttribute("data-resizing")).toBe(false)
			expect(widths()).toEqual([500])
		}))
})
