// @vitest-environment happy-dom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
// Lane A4's renderers on the real web host: events and their payloads, menus, reorder, scrollTo and
// the press-on-link default. Layout-bound behaviour (anchoring, stick to bottom) is checked in Chromium.
import { Renderer, UiSchema } from "@effect/ui"
import * as View from "@effect/ui/View"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import type { FixtureNode } from "../../../../conformance/schema.ts"
import { component, Host, HzBuilder, textParents } from "../../../../vocabulary/Hazel.ts"
import { type TagKey, tagName } from "../../../../vocabulary/spec.ts"
import * as WebHost from "../../../host.ts"

const Msg = UiSchema.TaggedEnum({ Fired: { event: Schema.String, payload: Schema.String } })
type Msg = typeof Msg.Type
const elements = { name: "hazel", textParents }

/** A fixture-shaped tree whose handlers record each event with its payload. */
const build = (node: FixtureNode): View.Input<Msg, never> => {
	let builder: View.ElementBuilder<Msg, never, any, unknown, string> = View.withFields(
		new HzBuilder<Msg, never, TagKey>(tagName(node.tag as TagKey)),
		{ props: { ...node.props } },
	)
	if (node.key !== undefined) builder = builder.key(node.key)
	for (const event of node.events ?? [])
		builder = builder.on(event, ((payload: unknown) =>
			Msg.Fired({ event, payload: JSON.stringify(payload ?? {}) })) as never)
	const children = (node.children ?? []).map((c) => (typeof c === "string" ? c : build(c)))
	return children.length === 0 ? builder : View.withNoTextContent(builder, children, elements)
}

const Tree = component({
	name: "A4Tree",
	props: Schema.Struct({ root: Schema.Unknown }),
	model: Schema.Struct({ fired: Schema.Array(Schema.String) }),
	message: Msg,
}).make({
	init: () => ({ fired: [] }),
	update: {
		Fired: ($, { event, payload }) => $.evolve({ fired: (all) => [...all, `${event} ${payload}`] }),
	},
	view: (h) => build(h.props.root as FixtureNode) as never,
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const mounted = <A>(
	root: FixtureNode,
	body: (dom: HTMLElement, fired: () => ReadonlyArray<string>) => Promise<A>,
) => {
	document.body.innerHTML = ""
	const container = document.createElement("div")
	document.body.append(container)
	return Effect.gen(function* () {
		const app = yield* Renderer.mount(Tree, { root }, container)
		yield* Effect.promise(settle)
		return yield* Effect.promise(() => body(container, () => app.model()?.fired ?? []))
	}).pipe(Effect.provide(WebHost.layer()), Effect.scoped, Effect.runPromise)
}

const item = (key: string, props: Record<string, unknown> = {}): FixtureNode => ({
	tag: "item",
	key,
	props: { title: key, ...props } as never,
	events: ["press"],
})

describe("lane A4 on the web host", () => {
	it("cancels a plain click on a link that handles press, and leaves a modified click to the browser", () =>
		mounted(
			{ tag: "section", children: [item("general", { href: "#/general" })] },
			async (dom, fired) => {
				const link = dom.querySelector("a[data-hz-part=control]") as HTMLAnchorElement
				const plain = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
				link.dispatchEvent(plain)
				await settle()
				expect(plain.defaultPrevented).toBe(true)
				expect(fired()).toEqual(["press {}"])
				const newTab = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true })
				link.dispatchEvent(newTab)
				await settle()
				expect(newTab.defaultPrevented).toBe(false)
				expect(fired()).toEqual(["press {}"])
			},
		))

	it("draws an item's subtitle, shortcut, elbow and disabled state", () =>
		mounted(
			{
				tag: "section",
				children: [
					item("thread", { subtitle: "Last", shortcut: "⌘K", nested: "last", href: "#" }),
					item("off", { disabled: true }),
				],
			},
			async (dom) => {
				const [thread, off] = [...dom.querySelectorAll<HTMLElement>("[data-hz=item]")]
				expect(thread!.querySelector("[data-hz-part=subtitle]")?.textContent).toBe("Last")
				expect(thread!.querySelector("[data-hz-part=shortcut]")?.textContent).toBe("⌘K")
				expect(thread!.getAttribute("data-nested")).toBe("last")
				expect(thread!.querySelector("[data-hz-part=elbow] path")?.getAttribute("d")).toContain(
					"V-27",
				)
				expect((off!.querySelector("button") as HTMLButtonElement).disabled).toBe(true)
			},
		))

	it("toggles a collapsible section and moves a row with Alt+Arrow", () =>
		mounted(
			{
				tag: "section",
				props: { title: "Projects", collapsible: true, reorderable: true },
				events: ["toggle", "move"],
				children: [item("a", { href: "#" }), item("b", { href: "#" }), item("c", { href: "#" })],
			},
			async (dom, fired) => {
				const disclosure = dom.querySelector("[data-hz-part=disclosure]") as HTMLButtonElement
				expect(disclosure.getAttribute("aria-expanded")).toBe("true")
				disclosure.click()
				const rows = [...dom.querySelectorAll<HTMLElement>("[data-hz=item]")]
				expect(rows[0]!.getAttribute("draggable")).toBe("true")
				const link = rows[0]!.querySelector("a")!
				link.dispatchEvent(
					new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
				)
				await settle()
				// Rows are named by their keys (`row-key`).
				expect(fired()).toEqual(['toggle {"collapsed":true}', 'move {"id":"a","before":"c"}'])
			},
		))

	it("opens the action menu and raises select with the entry's id", () =>
		mounted(
			{
				tag: "section",
				props: { title: "Projects" },
				children: [
					{
						tag: "action",
						props: {
							label: "New in Projects",
							entries: [
								{
									entries: [
										{ id: "create", label: "Create channel" },
										{ id: "off", label: "Off", disabled: true },
									],
								},
							],
						},
						events: ["select"],
					},
				],
			},
			async (dom, fired) => {
				const button = dom.querySelector("[data-hz=action]") as HTMLButtonElement
				expect(button.getAttribute("aria-haspopup")).toBe("menu")
				button.click()
				const menu = document.querySelector("[data-hz-menu]")!
				expect(menu.getAttribute("role")).toBe("menu")
				expect(button.getAttribute("aria-expanded")).toBe("true")
				;(menu.querySelector("[role=menuitem]") as HTMLElement).click()
				await settle()
				expect(fired()).toEqual(['select {"id":"create"}'])
				expect(document.querySelector("[data-hz-menu]")).toBeNull()
				expect(button.getAttribute("aria-expanded")).toBe("false")
			},
		))

	it("raises a tab bar's change, and a navigation's pop from the top screen's back", () =>
		mounted(
			{
				tag: "stack",
				children: [
					{
						tag: "tabBar",
						props: {
							tabs: [
								{ id: "home", label: "Home", icon: "hashtag" },
								{ id: "people", label: "People", icon: "users" },
							],
							selected: "home",
						},
						events: ["change"],
					},
					{
						tag: "navigation",
						events: ["pop"],
						children: [
							{ tag: "screen", props: { title: "One" } },
							{ tag: "screen", props: { title: "Two", back: true }, events: ["back"] },
						],
					},
				],
			},
			async (dom, fired) => {
				const tabs = [...dom.querySelectorAll<HTMLElement>("[role=tab]")]
				expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"])
				tabs[1]!.click()
				const backs = dom.querySelectorAll<HTMLButtonElement>("[data-hz-part=back]")
				backs[1]!.click()
				await settle()
				expect(fired()).toEqual(['change {"id":"people"}', "back {}", 'pop {"depth":1}'])
			},
		))

	it("scrolls a list to its edges with the scrollTo command", () =>
		mounted({ tag: "list", children: [item("a"), item("b")] }, async (dom) => {
			const list = dom.querySelector("[data-hz=list]")!
			const viewport = list.querySelector("[data-hz-part=viewport]") as HTMLElement
			const host = await Effect.runPromise(
				Effect.gen(function* () {
					return yield* Host
				}).pipe(Effect.provide(WebHost.layer()), Effect.scoped),
			)
			await Effect.runPromise(host.scrollTo(list, { to: "end" }))
			expect(viewport.scrollTop).toBe(viewport.scrollHeight)
			await Effect.runPromise(host.scrollTo(list, { to: "start" }))
			expect(viewport.scrollTop).toBe(0)
		}))
})
