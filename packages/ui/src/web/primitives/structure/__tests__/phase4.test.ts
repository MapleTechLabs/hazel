// @vitest-environment happy-dom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
// Lane W9's phase 4 structure on the real web host: the page header's crumbs, page tabs that link and
// reorder, a disclosure, a stepper, a property and the action bar. Layout is checked in Chromium.
import { Renderer, UiSchema } from "@effect/ui"
import * as View from "@effect/ui/View"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import type { FixtureNode } from "../../../../conformance/schema.ts"
import { component, HzBuilder, textParents } from "../../../../vocabulary/Hazel.ts"
import { type TagKey, tagName, tags } from "../../../../vocabulary/spec.ts"
import * as WebHost from "../../../host.ts"

const Msg = UiSchema.TaggedEnum({ Fired: { event: Schema.String, payload: Schema.String } })
type Msg = typeof Msg.Type
const elements = { name: "hazel", textParents }

/** A fixture-shaped tree (slots first, as `compile.ts`) whose handlers record each event and payload. */
const build = (node: FixtureNode): View.Input<Msg, never> => {
	let builder: View.ElementBuilder<Msg, never, any, unknown, string> = View.withFields(
		new HzBuilder<Msg, never, TagKey>(tagName(node.tag as TagKey)),
		{ props: { ...node.props } },
	)
	for (const event of node.events ?? [])
		builder = builder.on(event, ((payload: unknown) =>
			Msg.Fired({ event, payload: JSON.stringify(payload ?? {}) })) as never)
	const slots = (node.slots ?? []).map((slot) =>
		View.withNoTextContent(
			View.withFields(new HzBuilder<Msg, never, "slot">(tagName("slot")), {
				props: { name: slot.name },
			}),
			slot.children.map((c) => (typeof c === "string" ? c : build(c))),
			elements,
		),
	)
	const children = [...slots, ...(node.children ?? []).map((c) => (typeof c === "string" ? c : build(c)))]
	if (children.length === 0) return builder
	return tags[node.tag as TagKey].content === "text" && slots.length === 0
		? View.withContent(builder, children)
		: View.withNoTextContent(builder, children, elements)
}

const Tree = component({
	name: "W9Tree",
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

const click = (target: Element, init: MouseEventInit = {}) => {
	const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init })
	target.dispatchEvent(event)
	return event
}

describe("lane W9 (phase 4 structure) on the web host", () => {
	it("draws a page header's crumbs, subtitle and meta, and raises crumb for a plain click", () =>
		mounted(
			{
				tag: "screen",
				props: {
					title: "Acme",
					subtitle: "acme.com",
					crumbs: [{ label: "Customers", href: "#customers" }, { label: "Acme" }] as never,
				},
				events: ["crumb"],
				slots: [{ name: "meta", children: [{ tag: "badge", props: { label: "Pro" } }] }],
			},
			async (dom, fired) => {
				const nav = dom.querySelector("nav[aria-label=Breadcrumb]") as HTMLElement
				expect(nav.hidden).toBe(false)
				const [link, current] = [...nav.querySelectorAll("[data-hz-part=crumb]")]
				expect(link!.getAttribute("href")).toBe("#customers")
				expect(current!.getAttribute("aria-current")).toBe("page")
				expect(nav.querySelectorAll("[data-hz-part=crumbSeparator]")).toHaveLength(1)
				expect(dom.querySelector("[data-hz-part=subtitle]")!.textContent).toBe("acme.com")
				expect((dom.querySelector("[data-hz-part=metaRoom]") as HTMLElement).hidden).toBe(false)
				expect(click(link!, { metaKey: true }).defaultPrevented).toBe(false)
				expect(click(link!).defaultPrevented).toBe(true)
				await settle()
				expect(fired()).toEqual(['crumb {"index":0}'])
			},
		))

	it("links page tabs, selects on a plain click, and moves a tab with Alt+Arrow", () =>
		mounted(
			{
				tag: "tabBar",
				props: {
					style: "page",
					reorderable: true,
					selected: "open",
					tabs: [
						{ id: "open", label: "Open", badge: 2, href: "?tab=open" },
						{ id: "done", label: "Done", href: "?tab=done" },
						{ id: "all", label: "All" },
					] as never,
				},
				events: ["change", "move"],
			},
			async (dom, fired) => {
				expect(dom.querySelector("[data-hz=tabBar]")!.getAttribute("data-style")).toBe("page")
				const tabs = [...dom.querySelectorAll<HTMLElement>("[role=tab]")]
				expect(tabs.map((tab) => tab.tagName)).toEqual(["A", "A", "BUTTON"])
				expect(tabs[0]!.querySelector("[data-hz-part=tabIcon]")).toBeNull()
				expect(tabs.every((tab) => tab.getAttribute("draggable") === "true")).toBe(true)
				expect(click(tabs[1]!, { ctrlKey: true }).defaultPrevented).toBe(false)
				expect(click(tabs[1]!).defaultPrevented).toBe(true)
				tabs[0]!.dispatchEvent(
					new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }),
				)
				await settle()
				expect(fired()).toEqual(['change {"id":"done"}', 'move {"id":"open","before":"all"}'])
			},
		))

	it("toggles a disclosure with its next state, and hides the body while closed", () =>
		mounted(
			{
				tag: "disclosure",
				props: { title: "Thought for 4s", running: true },
				events: ["toggle"],
				slots: [{ name: "trailing", children: [{ tag: "badge", props: { label: "3" } }] }],
				children: [{ tag: "text", children: ["Checked #support."] }],
			},
			async (dom, fired) => {
				const root = dom.querySelector("[data-hz=disclosure]") as HTMLElement
				const header = root.querySelector("[data-hz-part=header]") as HTMLButtonElement
				expect(header.getAttribute("aria-expanded")).toBe("false")
				expect(header.getAttribute("aria-busy")).toBe("true")
				expect(root.hasAttribute("data-running")).toBe(true)
				const body = root.querySelector("[data-hz-part=body]")!
				expect(header.getAttribute("aria-controls")).toBe(body.id)
				expect(body.querySelector("[data-hz-slot=trailing]")).not.toBeNull()
				header.click()
				await settle()
				expect(fired()).toEqual(['toggle {"open":true}'])
			},
		))

	it("reports a stepper's place as a progress bar with one segment per step", () =>
		mounted({ tag: "stepper", props: { steps: 4, current: 2, label: "Step 2 of 4" } }, async (dom) => {
			const root = dom.querySelector("[data-hz=stepper]")!
			expect(root.getAttribute("role")).toBe("progressbar")
			expect(root.getAttribute("aria-valuenow")).toBe("2")
			expect(root.getAttribute("aria-valuemax")).toBe("4")
			expect(root.getAttribute("aria-valuetext")).toBe("Step 2 of 4")
			const steps = [...root.querySelectorAll<HTMLElement>("[data-hz-part=step]")]
			expect(steps.map((step) => step.dataset.done !== undefined)).toEqual([true, true, false, false])
		}))

	it("names a property's group by its label and keeps the value as its content", () =>
		mounted(
			{
				tag: "property",
				props: { label: "Plan" },
				children: [{ tag: "badge", props: { label: "Pro" } }],
			},
			async (dom) => {
				const root = dom.querySelector("[data-hz=property]")!
				const label = root.querySelector("[data-hz-part=label]")!
				expect(root.getAttribute("aria-labelledby")).toBe(label.id)
				expect(label.textContent).toBe("Plan")
				expect(root.querySelector("[data-hz-part=value] > [data-hz=badge]")).not.toBeNull()
			},
		))

	it("shows the action bar only while open, and dismisses from its close or Escape", () =>
		mounted(
			{
				tag: "actionBar",
				props: { open: true, label: "3 selected" },
				events: ["dismiss"],
				slots: [{ name: "actions", children: [{ tag: "button", props: { label: "Export" } }] }],
			},
			async (dom, fired) => {
				const bar = dom.querySelector("[data-hz=actionBar]") as HTMLElement
				expect(bar.hidden).toBe(false)
				expect(bar.getAttribute("role")).toBe("toolbar")
				expect(bar.getAttribute("aria-label")).toBe("3 selected")
				;(bar.querySelector("[data-hz-part=dismiss]") as HTMLButtonElement).click()
				bar.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
				await settle()
				expect(fired()).toEqual(["dismiss {}", "dismiss {}"])
			},
		))
})
