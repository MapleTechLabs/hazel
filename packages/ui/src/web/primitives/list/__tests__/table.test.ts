// @vitest-environment happy-dom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
// Lane W8's table on the real web host: roles and states, sort and select-all, the row checkbox that
// never presses its row, and the keyboard by row. Layout and pixels are checked in Chromium.
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
			Msg.Fired({
				event: `${node.key ?? node.tag} ${event}`,
				payload: JSON.stringify(payload ?? {}),
			})) as never)
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
	name: "W8Tree",
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

const click = (target: Element) =>
	target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))

const key = (target: Element, name: string, init: KeyboardEventInit = {}) => {
	const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init })
	target.dispatchEvent(event)
	return event
}

const columns = [
	{ key: "name", label: "Customer", width: "fill", sortable: true },
	{ key: "plan", label: "Plan", width: "narrow", optional: true },
	{ key: "mrr", label: "MRR", align: "end", sortable: true, width: "regular" },
]

const text = (value: string): FixtureNode => ({ tag: "text", children: [value] })

const row = (key: string, name: string, props: Record<string, unknown> = {}): FixtureNode => ({
	tag: "tableRow",
	key,
	props: props as never,
	events: ["press", "select"],
	children: [
		{ tag: "tableCell", props: { column: "name" }, children: [text(name)] },
		{ tag: "tableCell", props: { column: "plan" }, children: [text("Pro")] },
		{ tag: "tableCell", props: { column: "mrr" }, children: [text("$1")] },
	],
})

const customers = (rows: ReadonlyArray<FixtureNode>, props: Record<string, unknown> = {}): FixtureNode => ({
	tag: "table",
	key: "table",
	props: {
		label: "Customers",
		columns: columns as never,
		sort: { column: "mrr", direction: "descending" } as never,
		selectable: true,
		...props,
	} as never,
	events: ["sort", "selectAll"],
	children: [...rows],
})

const grid = (dom: HTMLElement) => dom.querySelector('[data-hz-part="grid"]') as HTMLElement
const rows = (dom: HTMLElement) => [...dom.querySelectorAll<HTMLElement>('[data-hz="tableRow"]')]
const checkOf = (scope: Element) =>
	scope.querySelector('[data-hz-part="selectCell"] [data-hz-part="control"]') as HTMLElement

describe("lane W8 (table) on the web host", () => {
	it("is a multiselectable grid with sorted, selected and current marks", () =>
		mounted(
			customers([
				row("acme", "Acme", { selected: true }),
				row("globex", "Globex", { current: true }),
				{ tag: "tableRow", key: "total", props: { footer: true }, children: [] },
			]),
			async (dom) => {
				const table = grid(dom)
				expect(table.getAttribute("role")).toBe("grid")
				expect(table.getAttribute("aria-label")).toBe("Customers")
				expect(table.getAttribute("aria-multiselectable")).toBe("true")
				const heads = [...dom.querySelectorAll('[data-hz-part="headCell"]')]
				expect(heads.map((head) => head.getAttribute("role"))).toEqual(Array(3).fill("columnheader"))
				expect(heads.map((head) => head.getAttribute("aria-sort"))).toEqual([
					null,
					null,
					"descending",
				])
				const [acme, globex, total] = rows(dom)
				expect(acme!.getAttribute("role")).toBe("row")
				expect(acme!.getAttribute("aria-selected")).toBe("true")
				expect(globex!.getAttribute("aria-selected")).toBe("false")
				expect(total!.hasAttribute("aria-selected")).toBe(false)
				expect(acme!.querySelector('[data-hz="tableCell"]')!.getAttribute("role")).toBe("gridcell")
				// The keyboard row holds the tab stop; the footer is not in the row order.
				expect(rows(dom).map((r) => r.getAttribute("tabindex"))).toEqual(["-1", "0", null])
				// One row of two selected: the header checkbox is mixed.
				expect(
					checkOf(dom.querySelector('[data-hz-part="headRow"]')!).getAttribute("aria-checked"),
				).toBe("mixed")
				expect(checkOf(acme!).getAttribute("aria-checked")).toBe("true")
				expect(checkOf(acme!).getAttribute("role")).toBe("checkbox")
			},
		))

	it("is a plain table of cells when nothing presses or selects", () =>
		mounted(
			{
				tag: "table",
				props: { label: "Plans", columns: columns as never },
				children: [
					{
						tag: "tableRow",
						children: [{ tag: "tableCell", props: { column: "name" }, children: [text("Pro")] }],
					},
				],
			},
			async (dom) => {
				expect(grid(dom).getAttribute("role")).toBe("table")
				expect(grid(dom).hasAttribute("aria-multiselectable")).toBe(false)
				expect(dom.querySelector('[data-hz="tableCell"]')!.getAttribute("role")).toBe("cell")
				expect(rows(dom)[0]!.hasAttribute("tabindex")).toBe(false)
			},
		))

	it("names each row's checkbox by its title or first cell, and sizes its cells by column", () =>
		mounted(customers([row("acme", "Acme"), row("b", "Beta", { title: "Beta Inc" })]), async (dom) => {
			const [acme, beta] = rows(dom)
			const name = (r: Element) => {
				const control = checkOf(r)
				const label = document.getElementById(control.getAttribute("aria-labelledby") ?? "")
				return label?.textContent
			}
			expect(name(acme!)).toBe("Select Acme")
			expect(name(beta!)).toBe("Select Beta Inc")
			const [first, plan, mrr] = [...acme!.querySelectorAll<HTMLElement>('[data-hz="tableCell"]')]
			expect(first!.dataset.width).toBe("fill")
			expect(plan!.hasAttribute("data-optional")).toBe(true)
			expect(mrr!.dataset.align).toBe("end")
			const root = dom.querySelector<HTMLElement>('[data-hz="table"]')!
			expect(root.style.getPropertyValue("--hz-table-columns")).toBe(
				"min-content minmax(calc(var(--hz-space-10) * 4), 1fr) min-content min-content",
			)
			expect(root.style.getPropertyValue("--hz-table-columns-compact")).toBe(
				"min-content minmax(calc(var(--hz-space-10) * 4), 1fr) min-content",
			)
		}))

	it("raises sort from a sortable header's button, and only from sortable ones", () =>
		mounted(customers([row("acme", "Acme")]), async (dom, fired) => {
			const buttons = [...dom.querySelectorAll('[data-hz-part="sort"]')]
			expect(buttons.map((button) => button.textContent)).toEqual(["Customer", "MRR"])
			// A native button: Enter and Space press it, as a click.
			expect(buttons.every((button) => button.tagName === "BUTTON")).toBe(true)
			expect(buttons[1]!.getAttribute("data-sorted")).toBe("descending")
			click(buttons[0]!)
			await settle()
			expect(fired()).toEqual(['table sort {"column":"name"}'])
		}))

	it("selects all from the header checkbox, and clears it once every row is selected", () =>
		mounted(
			customers([row("acme", "Acme", { selected: true }), row("b", "Beta")]),
			async (dom, fired) => {
				const all = checkOf(dom.querySelector('[data-hz-part="headRow"]')!)
				expect(all.getAttribute("aria-checked")).toBe("mixed")
				click(all)
				await settle()
				expect(fired()).toEqual(['table selectAll {"selected":true}'])
			},
		))

	it("clears all when every row is selected", () =>
		mounted(
			customers([row("acme", "Acme", { selected: true }), row("b", "Beta", { selected: true })]),
			async (dom, fired) => {
				const all = checkOf(dom.querySelector('[data-hz-part="headRow"]')!)
				expect(all.getAttribute("aria-checked")).toBe("true")
				click(all)
				await settle()
				expect(fired()).toEqual(['table selectAll {"selected":false}'])
			},
		))

	it("selects a row from its checkbox without pressing the row", () =>
		mounted(
			customers([row("acme", "Acme"), row("b", "Beta", { selected: true })]),
			async (dom, fired) => {
				const [acme, beta] = rows(dom)
				click(checkOf(acme!))
				click(checkOf(beta!))
				await settle()
				expect(fired()).toEqual(['acme select {"selected":true}', 'b select {"selected":false}'])
				click(acme!.querySelector('[data-hz="tableCell"]')!)
				await settle()
				expect(fired().at(-1)).toBe("acme press {}")
			},
		))

	it("moves by row with the arrows, Home and End, presses on Enter and selects on Space", () =>
		mounted(
			customers([row("a", "A"), row("b", "B"), row("c", "C", { disabled: true }), row("d", "D")]),
			async (dom, fired) => {
				const [a, b, , d] = rows(dom)
				a!.focus()
				expect(key(a!, "ArrowDown").defaultPrevented).toBe(true)
				expect(document.activeElement).toBe(b)
				// The disabled row is skipped.
				key(b!, "ArrowDown")
				expect(document.activeElement).toBe(d)
				expect(rows(dom).map((r) => r.getAttribute("tabindex"))).toEqual(["-1", "-1", null, "0"])
				key(d!, "Home")
				expect(document.activeElement).toBe(a)
				key(a!, "End")
				expect(document.activeElement).toBe(d)
				key(d!, "ArrowUp")
				expect(document.activeElement).toBe(b)
				key(b!, "Enter")
				key(b!, " ")
				await settle()
				expect(fired()).toEqual(["b press {}", 'b select {"selected":true}'])
				// Ctrl or Cmd+A on a row selects every row.
				expect(key(b!, "a", { metaKey: true }).defaultPrevented).toBe(true)
				await settle()
				expect(fired().at(-1)).toBe('table selectAll {"selected":true}')
			},
		))

	it("presses on Space when the table does not select", () =>
		mounted(customers([row("a", "A")], { selectable: false }), async (dom, fired) => {
			const [a] = rows(dom)
			expect(grid(dom).getAttribute("role")).toBe("grid")
			expect(a!.hasAttribute("aria-selected")).toBe(false)
			key(a!, " ")
			await settle()
			expect(fired()).toEqual(["a press {}"])
		}))

	it("spans a group heading over every column, and shows skeleton rows while loading", () =>
		mounted(
			customers(
				[
					{ tag: "tableRow", key: "g", props: { group: true, title: "Stripe" }, children: [] },
					row("a", "A"),
				],
				{ loading: true },
			),
			async (dom) => {
				const heading = rows(dom)[0]!.querySelector('[data-hz-part="heading"]')!
				expect(heading.textContent).toBe("Stripe")
				expect(heading.getAttribute("colspan")).toBe("4")
				expect(rows(dom)[0]!.getAttribute("tabindex")).toBeNull()
				expect(grid(dom).getAttribute("aria-busy")).toBe("true")
				const skeleton = dom.querySelector<HTMLElement>('[data-hz-part="skeleton"]')!
				expect(skeleton.hidden).toBe(false)
				expect(skeleton.getAttribute("aria-hidden")).toBe("true")
				expect(skeleton.querySelectorAll('[data-hz-part="skeletonRow"]')).toHaveLength(6)
			},
		))
})
