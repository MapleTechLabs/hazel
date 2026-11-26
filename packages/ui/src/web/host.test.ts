// @vitest-environment happy-dom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Renderer } from "@effect/ui"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { ChannelList } from "../demo/ChannelList.ts"
import { ActivityChart, MeshBackground } from "../demo/extensions.ts"
import { Rows, RowsMessage } from "../demo/Rows.ts"
import { registerDemoWebExtensions } from "../demo/web-extensions.ts"
import { missingWebExtensions } from "./extensions.ts"
import * as WebHost from "./host.ts"

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const container = () => {
	document.body.innerHTML = ""
	const element = document.createElement("div")
	document.body.append(element)
	return element
}

const titles = (root: Element) =>
	[...root.querySelectorAll("[data-hz=item] [data-hz-part=title]")].map((node) => node.textContent)

describe("web host", () => {
	it("builds each hz tag's structure, swaps link and button, and keeps nodes across a keyed reorder", async () => {
		const root = container()
		await Effect.gen(function* () {
			const app = yield* Renderer.mount(Rows, {}, root)
			yield* Effect.promise(settle)

			const section = root.querySelector(":scope > [data-hz=section]")!
			expect(section.tagName).toBe("SECTION")
			expect(section.querySelector(":scope > h2[data-hz-part=title]")?.textContent).toBe("Rows")
			const items = [...section.querySelectorAll(":scope > [data-hz-part=content] > [data-hz=item]")]
			expect(titles(root)).toEqual(["A", "B", "C"])
			// Slots are child elements inside the item's one content parent.
			const b = items[1]!
			expect(
				b.querySelector(
					":scope > a[data-hz-part=control] > [data-hz-part=content] > [data-hz=slot][data-name=leading] > [data-hz=icon][data-name=hashtag] > svg",
				),
			).not.toBeNull()
			expect(b.querySelector(":scope > a")?.getAttribute("href")).toBe("#/b")
			const slot = b.querySelector("[data-hz=slot]")!

			// Press b through the DOM: it becomes the selected row and a button, its slot node kept.
			;(b.querySelector("[data-hz-part=title]") as HTMLElement).click()
			yield* Effect.promise(settle)
			expect(app.model()?.selected).toBe("b")
			expect(b.hasAttribute("data-selected")).toBe(true)
			const control = b.querySelector(":scope > [data-hz-part=control]")!
			expect(control.tagName).toBe("BUTTON")
			expect(control.getAttribute("aria-current")).toBe("page")
			expect(b.querySelector("[data-hz=slot]")).toBe(slot)

			// Keyed reorder: the same item nodes, in the new order, still answering presses.
			app.send(RowsMessage.Reversed())
			yield* Effect.promise(settle)
			expect(titles(root)).toEqual(["C", "B", "A"])
			const after = [...section.querySelectorAll("[data-hz=item]")]
			expect(after).toEqual([items[2], items[1], items[0]])
			;(after[0]!.querySelector("[data-hz-part=title]") as HTMLElement).click()
			yield* Effect.promise(settle)
			expect(app.model()?.selected).toBe("c")
			expect(after[1]!.querySelector(":scope > [data-hz-part=control]")?.tagName).toBe("A")

			app.send(RowsMessage.Removed({ id: "a" }))
			yield* Effect.promise(settle)
			expect(titles(root)).toEqual(["C", "B"])
		}).pipe(Effect.provide(WebHost.layer()), Effect.scoped, Effect.runPromise)
	})

	it("draws the web-only extension and the iOS-only one's fallback", async () => {
		registerDemoWebExtensions()
		expect(missingWebExtensions([MeshBackground, ActivityChart])).toEqual([])
		const root = container()
		const sections = [
			{ title: "Team", channels: [{ id: "c1", title: "general", symbol: "number", unread: 2 }] },
			{ title: "Direct messages", channels: [{ id: "d1", title: "Grace Hopper", initials: "GH", unread: 0 }] },
		]
		await Effect.gen(function* () {
			yield* Renderer.mount(ChannelList, { sections, tickMs: 0 }, root)
			yield* Effect.promise(settle)
			const screen = root.querySelector(":scope > main[data-hz=screen]")!
			expect(screen.querySelector(":scope > header > h1")?.textContent).toBe("Channels")

			const chart = screen.querySelector("[data-hz=ext][data-ext=ActivityChart]")!
			expect(chart.hasAttribute("data-drawn")).toBe(true)
			expect(chart.querySelector(":scope > [data-hz-part=surface] > canvas")).not.toBeNull()

			const mesh = screen.querySelector("[data-hz=ext][data-ext=MeshBackground]")!
			expect(mesh.hasAttribute("data-drawn")).toBe(false)
			expect(mesh.querySelector(":scope > [data-hz-part=surface]")?.childElementCount).toBe(0)
			expect(
				mesh.querySelector(":scope > [data-hz-part=content] > [data-hz=slot][data-name=fallback] > [data-hz=text]")
					?.textContent,
			).toBe("Mesh background: drawn on iOS")

			const general = screen.querySelector("[data-hz=item]")!
			expect(general.querySelector("[data-hz-part=badge]")?.textContent).toBe("2")
			expect(general.hasAttribute("data-emphasized")).toBe(true)
			expect(screen.querySelector("[data-hz=avatar]")?.textContent).toBe("GH")
			const action = screen.querySelector("[data-hz=section] [data-hz=action]")!
			expect(action.tagName).toBe("BUTTON")
			expect(action.getAttribute("aria-label")).toBe("New in Team")
		}).pipe(Effect.provide(WebHost.layer()), Effect.scoped, Effect.runPromise)
	})
})
