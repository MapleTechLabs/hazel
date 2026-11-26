// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Renderer } from "@effect/ui"
import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { ChannelList } from "../demo/ChannelList.ts"
import { Rows, RowsMessage } from "../demo/Rows.ts"
import { makeNativeHost } from "./host.ts"
import { type Batch, WIRE_VERSION } from "./wire.ts"

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

/** Mounts `Rows` on the native host, runs `act`, and returns the batches of each step. */
const record = (
	act: (step: (message: typeof RowsMessage.Type) => Promise<ReadonlyArray<Batch>>) => Promise<void>,
) => {
	const batches: Array<Batch> = []
	return Effect.gen(function* () {
		const native = makeNativeHost((batch) => batches.push(batch))
		const root = yield* Renderer.mount(Rows, {}, native.container).pipe(Effect.provide(native.layer))
		yield* Effect.promise(settle)
		const mount = batches.splice(0)
		const steps: Array<ReadonlyArray<Batch>> = [mount]
		yield* Effect.promise(() =>
			act(async (message) => {
				root.send(message)
				await settle()
				const step = batches.splice(0)
				steps.push(step)
				return step
			}),
		)
		return { steps, native }
	}).pipe(Effect.scoped, Effect.runPromise)
}

/** The host must still send exactly the batches of the wire golden it was recorded from (C2). */
const golden = JSON.parse(
	readFileSync(resolve(import.meta.dirname, "__goldens__/host-session.json"), "utf8"),
) as {
	readonly steps: ReadonlyArray<{ readonly batch: Batch }>
}

describe("native host wire", () => {
	it("sends the host-session golden: mount, prop change, keyed reorder, removal", async () => {
		const { steps } = await record(async (step) => {
			await step(RowsMessage.PressedRow({ id: "b" }))
			await step(RowsMessage.Reversed())
			await step(RowsMessage.Removed({ id: "a" }))
		})
		const [mount = [], press = [], reorder = [], removal = []] = steps
		for (const step of steps) {
			// One batch per flush, versioned and numbered.
			expect(step).toHaveLength(1)
			expect(step[0]?.v).toBe(WIRE_VERSION)
		}
		expect(steps.flat().map((batch) => batch.seq)).toEqual([1, 2, 3, 4])
		expect(steps.map((step) => step[0])).toEqual(golden.steps.map((step) => step.batch))

		// A press changes only props: `selected` on and `href` dropped (button) for b, nothing created.
		expect(press[0]?.ops.every((op) => op[0] === "props")).toBe(true)
		// A keyed reorder moves existing nodes: inserts only, no create or remove.
		expect(new Set(reorder[0]?.ops.map((op) => op[0]))).toEqual(new Set(["insert"]))
		expect(removal[0]?.ops.map((op) => op[0])).toEqual(["remove"])
	})

	it("dedupes props by value and sends JSON for array and object props", async () => {
		const sent: Array<Batch> = []
		const batches = await Effect.gen(function* () {
			const native = makeNativeHost((batch) => sent.push(batch))
			const sections = [
				{ title: "Team", channels: [{ id: "c1", title: "general", symbol: "number", unread: 1 }] },
			]
			yield* Renderer.mount(ChannelList, { sections, tickMs: 0 }, native.container).pipe(
				Effect.provide(native.layer),
			)
			yield* Effect.promise(settle)
			const ext = [...native.nodes.values()].filter((node) => node.tag === "hz:ext")
			expect(ext.map((node) => JSON.parse(node.sent.get("ext") ?? "null"))).toEqual([
				"MeshBackground",
				"ActivityChart",
			])
			// An extension's own event reaches the view's handler.
			expect(native.fire(ext[0]!.id, "Tapped", {})).toBe(true)
			// A press on the row re-renders the view, which builds new `args` objects of the same value.
			const row = [...native.nodes.values()].find((node) => node.tag === "hz:item")!
			expect(native.fire(row.id, "press")).toBe(true)
			yield* Effect.promise(settle)
			// Before the scope closes: the unmount's own ops are not the screen's.
			return [...sent]
		}).pipe(Effect.scoped, Effect.runPromise)
		const props = batches.flatMap((batch) => batch.ops).filter((op) => op[0] === "props")
		expect(props).toContainEqual([
			"props",
			expect.any(Number),
			{ ext: "MeshBackground", args: { colors: ["brand.500", "brand.300"], speed: 0.4 } },
		])
		expect(batches).toHaveLength(2)
		// The press batch touches only the row: the extensions' equal `args` are not sent again.
		const row = batches[0]!.ops.find((op) => op[0] === "create" && op[2] === "hz:item")![1]
		expect(batches[1]!.ops).toEqual([
			["props", row, { badge: null, emphasized: null, selected: true, href: null }],
		])
	})
})
