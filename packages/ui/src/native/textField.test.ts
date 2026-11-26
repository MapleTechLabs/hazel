// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * G5: the native side simulated with `revisions.ts` (what `HzTextField.swift` mirrors). Keystrokes and
 * echoes cross two in-order channels with random delays, so echoes arrive late and out of step.
 */
import { Renderer } from "@effect/ui"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { tagsUpper, TextFieldDemo } from "../demo/TextFieldDemo.ts"
import { makeNativeHost } from "./host.ts"
import * as Revisions from "./revisions.ts"
import type { Batch, Json } from "./wire.ts"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A seeded PRNG, so a failure replays. */
const random = (seed: number) => () => {
	seed = (seed * 1664525 + 1013904223) % 4294967296
	return seed / 4294967296
}

/** Delivers in send order (a bridge never reorders), each held for a random delay up to `maxMs`. */
const channel = <A>(rand: () => number, maxMs: number, deliver: (value: A) => void) => {
	const queue: Array<{ readonly value: A; readonly at: number }> = []
	let draining = false
	const drain = () => {
		const head = queue[0]
		if (head === undefined) {
			draining = false
			return
		}
		const wait = head.at - Date.now()
		if (wait > 0) {
			setTimeout(drain, wait)
			return
		}
		queue.shift()
		deliver(head.value)
		drain()
	}
	return {
		send: (value: A) => {
			queue.push({ value, at: Date.now() + rand() * maxMs })
			if (draining) return
			draining = true
			setTimeout(drain, 0)
		},
		idle: () => queue.length === 0,
	}
}

type Key = string | "Backspace" | "Submit"

const run = (
	keys: ReadonlyArray<Key>,
	options: { readonly seed: number; readonly latencyMs: number; readonly naive?: boolean },
) =>
	Effect.gen(function* () {
		const rand = random(options.seed)
		let field = Revisions.initial
		let fieldId: number | undefined
		const shown: Array<string> = []
		const native = makeNativeHost((batch) => toNative.send(batch))
		const toJs = channel<readonly [string, Revisions.Change]>(
			rand,
			options.latencyMs,
			([event, payload]) => native.fire(fieldId ?? -1, event, { ...payload }),
		)
		const show = (next: Revisions.Field) => {
			field = next
			if (shown.at(-1) !== field.text) shown.push(field.text)
		}
		// Swift's side: applies the field's `value` props by the revision rule.
		const toNative = channel<Batch>(rand, options.latencyMs, (batch) => {
			for (const op of batch.ops) {
				if (op[0] === "create" && op[2] === "hz:textField") fieldId = op[1]
				if (op[0] !== "props" || op[1] !== fieldId || !("value" in op[2])) continue
				const incoming = Revisions.decode(op[2].value)
				if (incoming === undefined) continue
				// The control: a field that applies every value it is sent (what the Rune spike first did).
				const next = options.naive
					? { field: { ...field, text: incoming.text }, change: undefined }
					: Revisions.receive(field, incoming)
				show(next.field)
				if (next.change !== undefined) toJs.send(["change", next.change])
			}
		})
		const app = yield* Renderer.mount(TextFieldDemo, {}, native.container).pipe(
			Effect.provide(native.layer),
		)
		yield* Effect.promise(() => sleep(20))
		expect(fieldId).toBeDefined()

		yield* Effect.promise(async () => {
			for (const key of keys) {
				// Typing faster than the round trip: 0 to 3 ms between keys.
				await sleep(rand() * 3)
				if (key === "Submit") {
					toJs.send(["submit", Revisions.current(field)])
					continue
				}
				const text = key === "Backspace" ? field.text.slice(0, -1) : field.text + key
				const next = Revisions.edit(field, text)
				show(next.field)
				if (next.change !== undefined) toJs.send(["change", next.change])
			}
			// Settled: both channels empty across a quiet period longer than a render.
			for (let quiet = 0; quiet < 10;) {
				await sleep(10)
				quiet = toJs.idle() && toNative.idle() ? quiet + 1 : 0
			}
		})
		return { native: field.text, model: app.model()!, shown }
	}).pipe(Effect.scoped, Effect.runPromise)

const chars = (text: string): Array<Key> => [...text]
const typed = "the quick brown fox jumps over the lazy dog, then types some more words fast"

describe("hz:textField revisions over the native wire", () => {
	it("keeps every keystroke, in order, with late and out-of-step echoes", async () => {
		for (const seed of [1, 2, 3, 4, 5]) {
			const result = await run(chars(typed), { seed, latencyMs: 30 })
			expect(result.native).toBe(typed)
			expect(result.model.field.text).toBe(typed)
			// Never shown a dropped or reordered character: every frame is a prefix of what was typed.
			for (const text of result.shown) expect(typed.startsWith(text)).toBe(true)
		}
	})

	it("control: a field that applies every echo loses keystrokes in the same harness", async () => {
		const results = await Promise.all(
			[1, 2, 3].map((seed) => run(chars(typed), { seed, latencyMs: 30, naive: true })),
		)
		expect(results.some((result) => result.native !== typed)).toBe(true)
	})

	it("keeps edits that delete, too", async () => {
		const keys: Array<Key> = [
			...chars("hello wrld"),
			"Backspace",
			"Backspace",
			"Backspace",
			...chars("orld!"),
		]
		const result = await run(keys, { seed: 7, latencyMs: 30 })
		expect(result.native).toBe("hello world!")
		expect(result.model.field.text).toBe("hello world!")
	})

	it("applies the Model's #tag transform while typing on", async () => {
		const text = "ship #release today and #ops tomorrow"
		for (const seed of [11, 12, 13]) {
			const result = await run(chars(text), { seed, latencyMs: 30 })
			expect(result.native).toBe(tagsUpper(text))
			expect(result.model.field.text).toBe(tagsUpper(text))
		}
	})

	it("clears on submit, keeping what was typed after it", async () => {
		const keys: Array<Key> = [...chars("first line  "), "Submit", ...chars("second")]
		for (const seed of [21, 22, 23]) {
			const result = await run(keys, { seed, latencyMs: 30 })
			expect(result.model.sent).toEqual(["first line"])
			expect(result.native).toBe("second")
			expect(result.model.field.text).toBe("second")
		}
	})

	it("ignores a second Enter that lands before the clear", async () => {
		const keys: Array<Key> = [...chars("once"), "Submit", "Submit", ...chars("x")]
		for (const seed of [41, 42, 43]) {
			const result = await run(keys, { seed, latencyMs: 30 })
			expect(result.model.sent).toEqual(["once"])
			expect(result.native).toBe("x")
			expect(result.model.field.text).toBe("x")
		}
	})

	it("clears on submit when idle", async () => {
		const result = await run([...chars("done"), "Submit"], { seed: 31, latencyMs: 30 })
		expect(result.model.sent).toEqual(["done"])
		expect(result.native).toBe("")
		expect(result.model.field.text).toBe("")
	})
})
