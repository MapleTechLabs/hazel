// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Mounts the G7 list on the native host and collects its batches, the same way in node (vitest) and
 * in JavaScriptCore (`entry.ts`), so op counts and bytes agree across both.
 */
import { Renderer } from "@effect/ui"
import { Effect } from "effect"
import { makeNativeHost } from "../native/host.ts"
import type { Batch, Json } from "../native/wire.ts"
import { type ListProps, MessageList } from "./MessageList.ts"

export interface Taken {
	readonly batches: ReadonlyArray<Batch>
	readonly ops: number
	/** The batches as Swift receives them, one JSON per line. */
	readonly json: string
}

export interface Bench {
	readonly start: () => void
	/** An event on the list node, as Swift would fire it. */
	readonly fire: (event: string, payload?: Json) => boolean
	readonly take: () => Taken
	readonly nodeCount: () => number
	/** Live ids of the list's children, oldest first. */
	readonly listChildren: () => ReadonlyArray<number>
	readonly listId: () => number | undefined
}

export const defaults = (option: ListProps["option"], initial = 3000): ListProps => ({
	option,
	total: 3000,
	initial,
	page: 100,
	pad: 40,
})

export const makeBench = (props: ListProps): Bench => {
	let pending: Array<Batch> = []
	const native = makeNativeHost((batch) => pending.push(batch))
	const listId = () => {
		for (const node of native.nodes.values()) if (node.tag === "hz:list") return node.id
		return undefined
	}
	return {
		start: () => {
			Effect.gen(function* () {
				yield* Renderer.mount(MessageList, props, native.container)
				return yield* Effect.never
			}).pipe(Effect.provide(native.layer), Effect.scoped, Effect.runFork)
		},
		fire: (event, payload = {}) => {
			const id = listId()
			return id === undefined ? false : native.fire(id, event, payload)
		},
		take: () => {
			const batches = pending
			pending = []
			let ops = 0
			for (const batch of batches) ops += batch.ops.length
			return { batches, ops, json: batches.map((batch) => JSON.stringify(batch)).join("\n") }
		},
		nodeCount: () => native.nodes.size,
		listChildren: () => {
			const id = listId()
			const list = id === undefined ? undefined : native.nodes.get(id)
			return list === undefined ? [] : list.children.map((child) => child.id)
		},
		listId,
	}
}
