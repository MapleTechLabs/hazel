/**
 * The one compile rule for a fixture tree (phase 1.5): the wire batch a host would send for it.
 * Swift's `ConformanceFixtures.compile` mirrors this line for line; `conformance.test.ts` checks it
 * against what the native host really sends for the same tree.
 */
import { type Batch, type Json, type Op, WIRE_VERSION } from "../native/wire.ts"
import type { FixtureChild, FixtureNode } from "./schema.ts"

export const compile = (root: FixtureNode): Batch => {
	let next = 1
	const ops: Array<Op> = []
	const child = (input: FixtureChild): number => {
		if (typeof input !== "string") return node(input)
		const id = next++
		ops.push(["create", id, "#text"], ["text", id, input])
		return id
	}
	const node = (input: FixtureNode): number => {
		const id = next++
		ops.push(["create", id, `hz:${input.tag}`])
		// A keyed node carries its key as the wire prop `key` (`row-key`), as `Hazel.key` sends it.
		const props: { readonly [name: string]: Json } =
			input.key === undefined ? (input.props ?? {}) : { ...input.props, key: input.key }
		if (Object.keys(props).length > 0) ops.push(["props", id, props])
		if ((input.events ?? []).length > 0) ops.push(["events", id, input.events ?? []])
		for (const slot of input.slots ?? []) {
			const slotId = next++
			ops.push(["create", slotId, "hz:slot"], ["props", slotId, { name: slot.name }])
			for (const content of slot.children) ops.push(["insert", slotId, child(content), null])
			ops.push(["insert", id, slotId, null])
		}
		for (const content of input.children ?? []) ops.push(["insert", id, child(content), null])
		return id
	}
	ops.push(["insert", 0, node(root), null])
	return { v: WIRE_VERSION, seq: 1, ops }
}
