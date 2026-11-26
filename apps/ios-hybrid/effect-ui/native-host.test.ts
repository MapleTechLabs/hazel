import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import type { Section } from "./ChannelList"
import { mountChannelList } from "./mount"
import type { Op } from "./native-host"

const sections: ReadonlyArray<Section> = [
	{
		title: "Team",
		channels: [
			{ id: "c1", title: "general", symbol: "number", unread: 0 },
			{ id: "c2", title: "engineering", symbol: "number", unread: 0 },
		],
	},
	{
		title: "Direct messages",
		channels: [{ id: "d1", title: "Grace Hopper", initials: "GH", unread: 2 }],
	},
]

const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

/** Mounts with no DOM and records every batch the host sends. */
const run = async (tickMs: number, act: (fire: (id: number, event: string) => boolean) => Promise<void>) => {
	const batches: Array<ReadonlyArray<Op>> = []
	return Effect.gen(function* () {
		const native = yield* mountChannelList({ sections, tickMs }, (ops) => batches.push(ops))
		yield* Effect.promise(flush)
		yield* Effect.promise(() => act(native.fire))
		// Before the scope closes: the unmount's own ops are not the screen's.
		return [...batches]
	}).pipe(Effect.scoped, Effect.runPromise)
}

const idOf = (ops: ReadonlyArray<Op>, title: string): number => {
	const op = ops.find(
		(op) => op[0] === "attr" && op[2] === "data-ui-props" && op[3]?.includes(`"${title}"`),
	)
	if (op === undefined || op[0] !== "attr") throw new Error(`no node titled ${title}`)
	return op[1]
}

describe("native host", () => {
	it("sends the semantic tree and drops what the web alone draws", async () => {
		const [first = []] = await run(0, async () => {})
		const kinds = first.flatMap((op) => (op[0] === "attr" && op[2] === "data-ui" ? [op[3]] : []))
		expect(kinds).toEqual(["screen", "section", "action", "item", "item", "section", "action", "item"])
		expect(first.some((op) => op[0] === "attr" && op[2] !== "data-ui" && op[2] !== "data-ui-props")).toBe(
			false,
		)
	})

	it("answers a press with a few attribute changes, not the screen again", async () => {
		// Every mount numbers its nodes the same way: read general's id from one, press it in another.
		const [first = []] = await run(0, async () => {})
		const general = idOf(first, "general")
		const [, ...after] = await run(0, async (fire) => {
			expect(fire(general, "click")).toBe(true)
			await flush()
		})
		expect(after.flat()).toEqual([
			[
				"attr",
				general,
				"data-ui-props",
				JSON.stringify({ title: "general", symbol: "number", isSelected: true }),
			],
		])
	})

	it("sends one changed row for each message that lands elsewhere", async () => {
		const [, ...after] = await run(30, () => new Promise((resolve) => setTimeout(resolve, 45)))
		expect(after.length).toBeGreaterThan(0)
		for (const batch of after) {
			expect(batch).toHaveLength(1)
			expect(batch[0]?.slice(0, 1).concat(batch[0][2] ?? "")).toEqual(["attr", "data-ui-props"])
		}
	})
})
