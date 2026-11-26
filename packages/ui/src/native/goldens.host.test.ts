// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/// <reference types="vite/client" />
/**
 * C2 from the host's side: each golden's ops, played as the renderer's calls on the native host,
 * come out as that golden's batches; commands go through `Hazel.Host` and resolve on its replies.
 */
import type { Renderer } from "@effect/ui"
import { Effect, Exit, Fiber } from "effect"
import { describe, expect, it } from "vitest"
import { Hazel } from "../vocabulary/index.ts"
import { makeNativeHost, type NativeHost, type NativeNode } from "./host.ts"
import { Tree } from "./tree.ts"
import type { Batch, Json, Op } from "./wire.ts"

interface Golden {
	readonly steps: ReadonlyArray<{ readonly batch: Batch; readonly count: number }>
	readonly inbound?: ReadonlyArray<{ readonly message: Json }>
}
const files = import.meta.glob<Golden>("./__goldens__/*.json", { eager: true, import: "default" })
const golden = (file: string): Golden => files[`./__goldens__/${file}`]!

const dispatch: Renderer.Dispatch = () => true
const handlers = (names: ReadonlyArray<string>) => Object.fromEntries(names.map((name) => [name, name]))

/** Plays one golden op as the renderer would call the host. */
const play = (native: NativeHost, byId: Map<number, NativeNode>, op: Op) => {
	const { host } = native
	const at = (id: number) => (id === 0 ? native.container : byId.get(id)!)
	switch (op[0]) {
		case "create":
			// `#text` comes as create then text: `createText` sends both, at the `text` op.
			if (op[2] !== "#text") byId.set(op[1], host.createElement(op[2]))
			return
		case "text":
			if (byId.has(op[1])) host.setText(at(op[1]), op[2])
			else byId.set(op[1], host.createText(op[2]))
			return
		case "props":
			for (const [name, value] of Object.entries(op[2]))
				host.setProp(at(op[1]), name, value === null ? undefined : value)
			return
		case "insert": {
			const before = op[3] === null ? undefined : at(op[3])
			host.insertBefore(at(op[1]), at(op[2]), before)
			return
		}
		case "remove":
			host.remove(at(op[1]))
			return
		case "events":
			host.setEvents(at(op[1]), handlers(op[2]), dispatch, {})
			return
		case "detach":
			host.insertBefore(host.createContainer!(), at(op[1]), undefined)
			return
		case "command":
			throw new Error("commands go through Hazel.Host")
	}
}

const replayable = [
	"detach-reattach.json",
	"host-session.json",
	"structured-props.json",
	"text-revision.json",
	"utf8.json",
]

describe("the native host emits the goldens", () => {
	it.each(replayable)("%s", (file) => {
		const sent: Array<Batch> = []
		const native = makeNativeHost((batch) => sent.push(batch))
		const byId = new Map<number, NativeNode>()
		const tree = new Tree()
		for (const step of golden(file).steps) {
			for (const op of step.batch.ops) play(native, byId, op)
			native.host.commit!()
			const batch = sent.pop()
			expect(batch).toEqual(step.batch)
			tree.apply(batch!)
			// Freed with Swift's tree: the host keeps only what is live (the root included).
			expect(native.nodes.size).toBe(step.count)
		}
	})

	it("drops a controlled value that goes back in revision, and an echo of the same pair", () => {
		const sent: Array<Batch> = []
		const native = makeNativeHost((batch) => sent.push(batch))
		const field = native.host.createElement("hz:textField")
		const value = (text: string, rev: number, edit: number) =>
			native.host.setProp(field, "value", { text, rev, edit })
		value("hel", 3, 0)
		native.host.commit!()
		value("he", 2, 0) // stale: an older field revision
		value("hel", 3, 0) // a repeat
		native.host.commit!()
		value("", 1, 1) // a Model edit: `edit` moved on, so a lower `rev` is not stale
		value("x", 9, 0) // older Model edit
		native.host.commit!()
		expect(sent.map((batch) => batch.ops)).toEqual([
			[
				["create", 1, "hz:textField"],
				["props", 1, { value: { edit: 0, rev: 3, text: "hel" } }],
			],
			[["props", 1, { value: { edit: 1, rev: 1, text: "" } }]],
		])
	})
})

describe("Hazel.Host commands", () => {
	const mountCommands = () => {
		const sent: Array<Batch> = []
		const native = makeNativeHost((batch) => sent.push(batch))
		const byId = new Map<number, NativeNode>()
		const [mount] = golden("commands.json").steps
		for (const op of mount!.batch.ops) play(native, byId, op)
		native.host.commit!()
		return { native, sent, field: byId.get(1)!, list: byId.get(2)! }
	}
	const run = <A, E>(native: NativeHost, effect: Effect.Effect<A, E, Hazel.Host>) =>
		Effect.runFork(effect.pipe(Effect.provide(native.layer)))
	const measure = (node: NativeNode) =>
		Effect.gen(function* () {
			return yield* (yield* Hazel.Host).measure(node)
		})
	const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

	it("send the commands golden and resolve on its replies", async () => {
		const { native, sent, field, list } = mountCommands()
		const commands = golden("commands.json")
		expect(sent).toEqual([commands.steps[0]!.batch])
		const fiber = run(
			native,
			Effect.gen(function* () {
				const host = yield* Hazel.Host
				return yield* Effect.all(
					[
						host.focus(field),
						host.scrollTo(list, { key: "m42" }),
						host.measure(field),
						host.select(field, { start: 0, end: 3 }),
					],
					{ concurrency: "unbounded" },
				)
			}),
		)
		await tick()
		// Outside a flush: sent on the host's own microtask, as one batch.
		expect(sent[1]).toEqual(commands.steps[1]!.batch)
		expect(native.pendingCommands()).toBe(4)
		for (const { message } of commands.inbound ?? []) native.receive(JSON.stringify(message))
		const exit = await Effect.runPromise(Fiber.await(fiber))
		// The failed select is logged, not the screen's error; measure carries its rect.
		expect(exit).toEqual(
			Exit.succeed([undefined, undefined, { x: 16, y: 120.5, width: 370, height: 44 }, undefined]),
		)
		expect(native.pendingCommands()).toBe(0)
	})

	it("fail a measure on a removed node without sending it, and drop a late reply", async () => {
		const { native, sent, field, list } = mountCommands()
		native.host.remove(field)
		native.host.commit!()
		const removed = await Effect.runPromise(Fiber.await(run(native, measure(field))))
		expect(Exit.isFailure(removed)).toBe(true)

		const fiber = run(native, measure(list))
		await tick()
		const request = sent.at(-1)!.ops[0]!
		expect(request).toEqual(["command", 1, list.id, "measure", null])
		await Effect.runPromise(Fiber.interrupt(fiber))
		expect(native.pendingCommands()).toBe(0)
		// Nobody waits for it any more: ignored.
		native.receive(JSON.stringify(["reply", 1, true, { x: 0, y: 0, width: 1, height: 1 }]))
	})

	it("die on a measure reply that is not a rect", async () => {
		const { native, list } = mountCommands()
		const fiber = run(native, measure(list))
		await tick()
		native.receive(JSON.stringify(["reply", 1, true, { x: 1 }]))
		const exit = await Effect.runPromise(Fiber.await(fiber))
		expect(Exit.hasDies(exit)).toBe(true)
	})
})
