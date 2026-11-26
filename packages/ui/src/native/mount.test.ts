// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The native host under a real mount: kept-alive children cross as `detach`, removed subtrees leave
 * the host, inbound messages coalesce into one batch, and extensions cross with typed props.
 */
import { Renderer, UiSchema } from "@effect/ui"
import { Effect, type Scope, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { Rows, RowsMessage } from "../demo/Rows.ts"
import { Hazel } from "../vocabulary/index.ts"
import { makeNativeHost, type NativeHost, type NativeHostOptions, type NativeNode } from "./host.ts"
import { Tree } from "./tree.ts"
import type { Batch, Op } from "./wire.ts"

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

interface Session {
	readonly native: NativeHost
	readonly tree: Tree
	readonly batches: () => ReadonlyArray<Batch>
}

/** Mounts a root on a native host, applying every batch to the reference tree as Swift would. */
const session = <A>(
	mount: (native: NativeHost) => Effect.Effect<A, never, Renderer.Renderer | Hazel.Host | Scope.Scope>,
	act: (s: Session & { readonly root: A }) => Promise<void>,
	options?: NativeHostOptions,
) => {
	const sent: Array<Batch> = []
	const tree = new Tree()
	const native = makeNativeHost((batch) => {
		sent.push(batch)
		tree.apply(batch)
	}, options)
	return Effect.gen(function* () {
		const root = yield* mount(native).pipe(Effect.provide(native.layer))
		yield* Effect.promise(settle)
		yield* Effect.promise(() => act({ native, tree, root, batches: () => sent.splice(0) }))
	}).pipe(Effect.scoped, Effect.runPromise)
}

const ops = (batches: ReadonlyArray<Batch>): ReadonlyArray<Op> => batches.flatMap((batch) => batch.ops)
const find = (native: NativeHost, tag: string, title?: string): NativeNode =>
	[...native.nodes.values()].find(
		(node) =>
			node.tag === tag && (title === undefined || node.sent.get("title") === JSON.stringify(title)),
	)!

const Panel = Hazel.component({
	name: "Panel",
	props: Schema.Struct({ label: Schema.String }),
	model: Schema.Struct({}),
	message: Schema.Never,
}).make({
	init: () => ({}),
	update: {},
	view: (h) => h.section.title(h.props.label).children(h.item.title(`${h.props.label} row`)),
})

const TabsMessage = UiSchema.TaggedEnum({ Switched: { tab: Schema.String } })
const Tabs = Hazel.component({
	name: "Tabs",
	props: Schema.Struct({}),
	model: Schema.Struct({ tab: Schema.String }),
	message: TabsMessage,
}).make({
	init: () => ({ tab: "a" }),
	update: { Switched: ($, { tab }) => $.evolve({ tab }) },
	view: (h, model) =>
		h.screen
			.title("Tabs")
			.children(
				model.tab === "a"
					? h.keepAlive((s) => Panel(s, { key: "a", props: { label: "A" } }))
					: h.keepAlive((s) => Panel(s, { key: "b", props: { label: "B" } })),
			),
})

describe("native host under a mount", () => {
	it("detaches a kept-alive child and moves it back without creating it again", async () => {
		await session(
			(native) => Renderer.mount(Tabs, {}, native.container),
			async ({ native, tree, root, batches }) => {
				const send = root.send
				batches()
				const a = find(native, "hz:section", "A")
				send(TabsMessage.Switched({ tab: "b" }))
				await settle()
				const away = ops(batches())
				expect(away).toContainEqual(["detach", a.id])
				expect(tree.detached.has(a.id)).toBe(true)
				// The container stays on this side: no `#container` crosses.
				expect(away.some((op) => op[0] === "create" && op[2] === "#container")).toBe(false)

				send(TabsMessage.Switched({ tab: "a" }))
				await settle()
				const back = ops(batches())
				const b = find(native, "hz:section", "B")
				// Back in place of B, which is kept in turn.
				expect(back).toEqual([
					["insert", find(native, "hz:screen").id, a.id, b.id],
					["detach", b.id],
				])
				expect(tree.detached.has(a.id)).toBe(false)
				expect(tree.outline().some((line) => line.includes('"A row"'))).toBe(true)
			},
		)
	})

	it("frees a removed row's subtree in the host and in the tree", async () => {
		await session(
			(native) => Renderer.mount(Rows, {}, native.container),
			async ({ native, tree, root }) => {
				const send = root.send
				const before = native.nodes.size
				const row = find(native, "hz:item", "A")
				const subtree = [row, ...row.children, ...row.children.flatMap((child) => child.children)]
				send(RowsMessage.Removed({ id: "a" }))
				await settle()
				for (const node of subtree) {
					expect(native.nodes.has(node.id)).toBe(false)
					expect(node.live).toBe(false)
					expect(tree.has(node.id)).toBe(false)
				}
				expect(native.nodes.size).toBe(before - subtree.length)
				expect(native.nodes.size).toBe(tree.count)
				// A late event on a freed node reaches nobody.
				expect(native.fire(row.id, "press")).toBe(false)
			},
		)
	})

	it("renders many inbound messages of one turn as one batch", async () => {
		await session(
			(native) => Renderer.mount(Rows, {}, native.container),
			async ({ native, batches }) => {
				batches()
				const ids = ["A", "B", "C"].map((title) => find(native, "hz:item", title).id)
				native.receiveMany(JSON.stringify(ids.map((id, at) => ["fire", id, "press", {}, at + 1])))
				await settle()
				const step = batches()
				expect(step).toHaveLength(1)
				// The last press wins: C selected, the others not.
				expect(step[0]!.ops).toContainEqual([
					"props",
					ids[2],
					expect.objectContaining({ selected: true }),
				])
			},
		)
	})
})

const Stamp = Hazel.extension({
	name: "Stamp",
	props: Schema.Struct({ count: Schema.NumberFromString }),
	events: { Counted: Schema.Struct({ count: Schema.NumberFromString }) },
	platforms: ["ios"],
})
const StampsMessage = UiSchema.TaggedEnum({ Counted: { count: Schema.Number } })
const Stamps = Hazel.component({
	name: "Stamps",
	props: Schema.Struct({}),
	model: Schema.Struct({ count: Schema.Number }),
	message: StampsMessage,
}).make({
	init: () => ({ count: 2 }),
	update: { Counted: ($, { count }) => $.evolve({ count }) },
	view: (h, model) =>
		h.screen.children(
			h
				.extension(Stamp, { count: model.count })
				.on("Counted", ({ count }) => StampsMessage.Counted({ count })),
		),
})

describe("extensions over the native wire", () => {
	it("encode their props and decode their events with the extension's Schemas", async () => {
		await session(
			(native) => Renderer.mount(Stamps, {}, native.container),
			async ({ native, tree, batches }) => {
				const ext = find(native, "hz:ext")
				expect(tree.outline().find((line) => line.includes("hz:ext"))).toContain('args={count:"2"}')
				batches()
				expect(native.fire(ext.id, "Counted", { count: "5" })).toBe(true)
				await settle()
				expect(ops(batches())).toEqual([["props", ext.id, { args: { count: "5" } }]])
				// A payload its Schema refuses never reaches the view.
				expect(native.fire(ext.id, "Counted", { count: 5 })).toBe(false)
			},
			{ extensions: [Stamp] },
		)
	})
})
