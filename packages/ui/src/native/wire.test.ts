/// <reference types="vite/client" />
import { describe, expect, it } from "vitest"
import { Tree } from "./tree.ts"
import { decodeBatch, decodeInbound, describeInbound, describeOp, WireError } from "./wire.ts"

/** C2: every golden decodes to its canonical ops and applies to its tree. Swift checks the same files. */
const files = import.meta.glob<unknown>("./__goldens__/*.json", { eager: true, import: "default" })
const read = (file: string) => files[`./__goldens__/${file}`]
const streams = Object.keys(files)
	.map((path) => path.slice("./__goldens__/".length))
	.filter((file) => file !== "rejects.json")

interface Step {
	readonly batch: unknown
	readonly ops: ReadonlyArray<string>
	readonly tree: ReadonlyArray<string>
	readonly count: number
	readonly detached: ReadonlyArray<number>
}

describe("wire goldens", () => {
	it.each(streams)("%s decodes and applies as recorded", (file) => {
		const golden = read(file) as {
			steps: ReadonlyArray<Step>
			inbound?: ReadonlyArray<{ message: unknown; decoded: string }>
		}
		const tree = new Tree()
		for (const step of golden.steps) {
			// From the file's bytes, as Swift reads them.
			const batch = decodeBatch(
				JSON.parse(new TextDecoder().decode(new TextEncoder().encode(JSON.stringify(step.batch)))),
			)
			expect(batch.ops.map(describeOp)).toEqual(step.ops)
			tree.apply(batch)
			expect(tree.outline()).toEqual(step.tree)
			expect(tree.count).toBe(step.count)
			expect([...tree.detached].sort()).toEqual(step.detached)
		}
		for (const { message, decoded } of golden.inbound ?? [])
			expect(describeInbound(decodeInbound(message))).toBe(decoded)
	})

	it("refuses what Swift refuses", () => {
		const { rejects } = read("rejects.json") as { rejects: ReadonlyArray<{ batch: unknown }> }
		for (const { batch } of rejects) expect(() => decodeBatch(batch)).toThrow(WireError)
	})

	it("rejects a batch out of sequence", () => {
		expect(() => new Tree().apply({ v: 2, seq: 2, ops: [] })).toThrow(/out of order/)
	})
})
