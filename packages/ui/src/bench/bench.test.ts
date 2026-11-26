// @effect-diagnostics experimentalApiUsage:off
import { describe, expect, it } from "vitest"
import type { Op } from "../native/wire.ts"
import { defaults, makeBench } from "./harness.ts"
import type { Option } from "./MessageList.ts"
import { BlockKind, parse, RunKind } from "./rich-text.ts"
import { names } from "./rows.ts"

const idle = async () => {
	for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const count = (ops: ReadonlyArray<Op>) => {
	const out: Record<string, number> = {}
	for (const op of ops) out[op[0]] = (out[op[0]] ?? 0) + 1
	return out
}

const mounted = async (option: Option, initial = 3000) => {
	const bench = makeBench(defaults(option, initial))
	const t0 = performance.now()
	bench.start()
	await idle()
	const mount = bench.take()
	return { bench, mount, ms: performance.now() - t0 }
}

describe("rich text", () => {
	it("parses mentions, links, inline code, strong, code blocks and lists", () => {
		const blocks = parse(
			"Hi @[userId:u2], see https://x.dev/a and `code` **now**\n\n```ts\nlet a = 1\n```\n- one\n1. two",
			names,
		)
		expect(blocks[0]).toEqual([
			BlockKind.paragraph,
			[
				"Hi ",
				[RunKind.mention, "@Grace Hopper", "u2"],
				", see ",
				[RunKind.link, "https://x.dev/a", "https://x.dev/a"],
				" and ",
				[RunKind.code, "code"],
				" ",
				[RunKind.strong, "now"],
			],
		])
		expect(blocks[1]).toEqual([BlockKind.code, "let a = 1", "ts"])
		expect(blocks.slice(2)).toEqual([
			[BlockKind.item, ["one"], "•"],
			[BlockKind.item, ["two"], "1."],
		])
	})
})

describe.each(["A", "B", "C", "S"] as const)("option %s", (option) => {
	it("mounts, adds a message, reacts and prepends with keyed ops only", async () => {
		const { bench, mount, ms } = await mounted(option)
		const children = bench.listChildren()
		expect(mount.ops).toBeGreaterThan(0)
		if (option === "B") expect(children.length).toBeLessThanOrEqual(81)
		else expect(children.length).toBeGreaterThan(3000)

		bench.fire("bench", { kind: "new" })
		await idle()
		const added = bench.take()
		const addedOps = added.batches.flatMap((b) => b.ops)
		// One new row: its creates, and one insert into the list. No other row is touched.
		expect(addedOps.filter((op) => op[0] === "insert" && op[1] === bench.listId())).toHaveLength(1)
		expect(addedOps.filter((op) => op[0] === "remove")).toHaveLength(option === "B" ? 1 : 0)

		const target = "m002996"
		bench.fire("bench", { kind: "react", id: target })
		await idle()
		const reacted = bench.take()
		const reactedOps = reacted.batches.flatMap((b) => b.ops)
		expect(reactedOps.filter((op) => op[0] === "create" && op[2] === "hz:message")).toHaveLength(0)
		if (option === "C" || option === "S") expect(count(reactedOps)).toEqual({ props: 1 })

		const paged = (await mounted(option, 2900)).bench
		paged.fire("reachStart")
		await idle()
		const older = paged.take()
		if (option !== "B") expect(paged.listChildren().length).toBeGreaterThan(3000)
		console.log(
			`G7_NODE option ${option}: mount ${ms.toFixed(1)} ms, ${mount.ops} ops, ${mount.json.length} bytes, ${bench.nodeCount()} nodes; ` +
				`new ${added.ops} ops ${added.json.length} B; react ${reacted.ops} ops ${reacted.json.length} B ${JSON.stringify(count(reactedOps))}; ` +
				`older page ${older.ops} ops ${older.json.length} B`,
		)
	})
})

describe("option B windowing", () => {
	it("slides its window when native reports a viewport near an edge", async () => {
		const { bench } = await mounted("B")
		const before = bench.listChildren()
		bench.fire("viewport", { first: 60, last: 75 })
		await idle()
		const slid = bench.take()
		const ops = count(slid.batches.flatMap((b) => b.ops))
		const after = bench.listChildren()
		expect(after).not.toEqual(before)
		console.log(`G7_NODE option B slide by ~60 entries: ${slid.ops} ops, ${slid.json.length} B ${JSON.stringify(ops)}`)
	})
})
