/**
 * Writes the wire goldens (`src/native/__goldens__/*.json`, contract C2) from the streams below: each
 * step's batch with its canonical `ops` and the `tree` after it, from `wire.ts` and `native/tree.ts`.
 * TS (`wire.test.ts`) and Swift (`GoldenTests.swift`) both decode every file to the same text.
 *   bun scripts/wire-goldens.ts           (the integrator runs it when a stream changes)
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Tree } from "../src/native/tree.ts"
import {
	type Batch,
	decodeBatch,
	decodeInbound,
	describeInbound,
	describeOp,
	type Inbound,
	type Op,
	WIRE_VERSION,
} from "../src/native/wire.ts"

const dir = resolve(import.meta.dirname, "../src/native/__goldens__")
mkdirSync(dir, { recursive: true })

interface Stream {
	readonly about: string
	readonly batches: ReadonlyArray<ReadonlyArray<Op>>
	readonly inbound?: ReadonlyArray<Inbound>
}

const batch = (seq: number, ops: ReadonlyArray<Op>): Batch => ({ v: WIRE_VERSION, seq, ops })

/** The G1 host session (`demo/Rows.ts` on the native host): `host.test.ts` checks the host still sends it. */
const hostSession: Stream = {
	about: "The native host mounting demo/Rows.ts, then a press, a keyed reorder and a removal (host.test.ts).",
	batches: [
		[
			["create", 1, "hz:section"],
			["create", 2, "hz:item"],
			["create", 3, "hz:slot"],
			["create", 4, "hz:icon"],
			["props", 4, { name: "hashtag" }],
			["insert", 3, 4, null],
			["props", 3, { name: "leading" }],
			["insert", 2, 3, null],
			["props", 2, { title: "A", href: "#/a", key: "a" }],
			["events", 2, ["press"]],
			["insert", 1, 2, null],
			["create", 5, "hz:item"],
			["create", 6, "hz:slot"],
			["create", 7, "hz:icon"],
			["props", 7, { name: "hashtag" }],
			["insert", 6, 7, null],
			["props", 6, { name: "leading" }],
			["insert", 5, 6, null],
			["props", 5, { title: "B", href: "#/b", key: "b" }],
			["events", 5, ["press"]],
			["insert", 1, 5, null],
			["create", 8, "hz:item"],
			["create", 9, "hz:slot"],
			["create", 10, "hz:icon"],
			["props", 10, { name: "hashtag" }],
			["insert", 9, 10, null],
			["props", 9, { name: "leading" }],
			["insert", 8, 9, null],
			["props", 8, { title: "C", href: "#/c", key: "c" }],
			["events", 8, ["press"]],
			["insert", 1, 8, null],
			["props", 1, { title: "Rows" }],
			["insert", 0, 1, null],
		],
		[["props", 5, { href: null, selected: true }]],
		[
			["insert", 1, 5, 2],
			["insert", 1, 8, 5],
		],
		[["remove", 2]],
	],
}

const detach: Stream = {
	about: "A kept-alive subtree: detached, changed while out of the tree, reinserted, then detached and freed.",
	batches: [
		[
			["create", 1, "hz:screen"],
			["create", 2, "hz:section"],
			["props", 2, { title: "kept" }],
			["create", 3, "hz:item"],
			["props", 3, { title: "row" }],
			["insert", 2, 3, null],
			["insert", 1, 2, null],
			["insert", 0, 1, null],
		],
		[["detach", 2]],
		[["props", 3, { title: "row while detached" }]],
		[["insert", 1, 2, null]],
		[
			["detach", 2],
			["remove", 2],
		],
	],
}

const structured: Stream = {
	about: "Structured props (G7 option C): a message leaf with rich text, reactions and files, a menu, then one key changing.",
	batches: [
		[
			["create", 1, "hz:list"],
			["props", 1, { anchor: "end", stickToBottom: true }],
			["events", 1, ["reachStart"]],
			["create", 2, "hz:message"],
			[
				"props",
				2,
				{
					row: {
						author: "Ada Lovelace",
						initials: "AL",
						provider: "slack",
						time: "14:05",
						body: [
							[
								0,
								[
									"Ship it ",
									[1, "@Grace", "u2"],
									", see ",
									[2, "the doc", "https://hazel.sh/d"],
								],
							],
							[1, "bun run test", "sh"],
						],
						reactions: [
							{
								emoji: "👍",
								count: 3,
								mine: true,
								who: { names: ["Grace", "Alan"], others: 1 },
							},
							{ emoji: "🎉", count: 1, mine: false },
						],
						edited: true,
						files: [{ id: "f1", kind: "image", name: "shot.png", width: 1280, height: 720 }],
						actions: ["react", "reply", "thread"],
					},
				},
			],
			["events", 2, ["action", "pressReaction"]],
			["insert", 1, 2, null],
			["create", 3, "hz:menu"],
			["props", 3, { entries: [{ entries: [{ id: "mute", label: "Mute", icon: "volume-mute" }] }] }],
			["insert", 1, 3, null],
			["insert", 0, 1, null],
		],
		[["props", 2, { pinned: true, grouped: true }]],
		[["props", 3, { entries: null }]],
	],
}

const revisions: Stream = {
	about: "A text field's revision pair (G5): Model echoes, a stale value, a Model edit (clear), the field's events.",
	batches: [
		[
			["create", 1, "hz:textField"],
			["props", 1, { label: "Name", value: { text: "", rev: 0, edit: 0 } }],
			["events", 1, ["change", "submit"]],
			["insert", 0, 1, null],
		],
		[["props", 1, { value: { text: "hel", rev: 3, edit: 0 } }]],
		[["props", 1, { value: { text: "", rev: 5, edit: 1 } }]],
	],
	inbound: [
		["fire", 1, "change", { value: "hel", rev: 3, edit: 0 }, 1],
		["fire", 1, "change", { value: "hello", rev: 5, edit: 0 }, 2],
		["fire", 1, "submit", { value: "hello", rev: 5, edit: 0 }, 2],
	],
}

const commands: Stream = {
	about: "Commands and their replies: focus, scrollTo a key, measure (a rect back), and a failed select.",
	batches: [
		[
			["create", 1, "hz:textField"],
			["insert", 0, 1, null],
			["create", 2, "hz:list"],
			["insert", 0, 2, null],
		],
		[
			["command", 1, 1, "focus", null],
			["command", 2, 2, "scrollTo", { key: "m42" }],
			["command", 3, 1, "measure", null],
			["command", 4, 1, "select", { start: 0, end: 3 }],
		],
	],
	inbound: [
		["reply", 1, true, null],
		["reply", 2, true, null],
		["reply", 3, true, { x: 16, y: 120.5, width: 370, height: 44 }],
		["reply", 4, false, "no text to select"],
	],
}

const utf8: Stream = {
	about: "Text beyond ASCII crosses as UTF-8 bytes: emoji with modifiers and joiners, CJK, combining marks, RTL.",
	batches: [
		[
			["create", 1, "hz:text"],
			["create", 2, "#text"],
			["text", 2, "Café 👩🏽‍💻 你好 é שלום"],
			["insert", 1, 2, null],
			["insert", 0, 1, null],
			["create", 3, "hz:item"],
			["props", 3, { title: "🧪 ünïcødé", badge: 2 }],
			["insert", 0, 3, null],
		],
		[["text", 2, "🇺🇦🏳️‍🌈"]],
	],
	inbound: [["fire", 3, "press", { note: "日本語 ✓" }, 2]],
}

const streams = {
	"host-session": hostSession,
	"detach-reattach": detach,
	"structured-props": structured,
	"text-revision": revisions,
	commands,
	utf8,
} as const satisfies Readonly<Record<string, Stream>>

const steps = (stream: Stream) => {
	const tree = new Tree()
	return stream.batches.map((ops, index) => {
		// Through the encoder and the validating decoder, as the bytes would go.
		const decoded = decodeBatch(JSON.parse(JSON.stringify(batch(index + 1, ops))))
		tree.apply(decoded)
		return {
			batch: batch(index + 1, ops),
			ops: decoded.ops.map(describeOp),
			tree: tree.outline(),
			count: tree.count,
			detached: [...tree.detached].sort(),
		}
	})
}

interface Golden {
	readonly about: string
	readonly steps: ReturnType<typeof steps>
	inbound?: ReadonlyArray<{ readonly message: Inbound; readonly decoded: string }>
}

/** Messages both sides must refuse, by the error each reports. */
const rejects = {
	about: "Batches both decoders refuse, by error kind.",
	rejects: [
		{ batch: { v: 3, seq: 1, ops: [] }, error: "unsupportedVersion" },
		{ batch: { v: 2, seq: 1, ops: [["element", 1, "div"]] }, error: "unknownOp" },
		{ batch: { v: 2, ops: [] }, error: "malformed" },
		{ batch: { v: 2, seq: 1, ops: [["create", "1", "hz:text"]] }, error: "malformed" },
		{ batch: { v: 2, seq: 1, ops: [["command", 1, 2, "explode", null]] }, error: "malformed" },
	],
}

for (const [name, stream] of Object.entries(streams)) {
	const golden: Golden = {
		about: stream.about,
		steps: steps(stream),
	}
	const inbound: ReadonlyArray<Inbound> | undefined = "inbound" in stream ? stream.inbound : undefined
	if (inbound !== undefined)
		golden.inbound = inbound.map((message) => ({
			message,
			decoded: describeInbound(decodeInbound(JSON.parse(JSON.stringify(message)))),
		}))
	writeFileSync(resolve(dir, `${name}.json`), `${JSON.stringify(golden, null, "\t")}\n`)
}
writeFileSync(resolve(dir, "rejects.json"), `${JSON.stringify(rejects, null, "\t")}\n`)
console.log(`wrote ${Object.keys(streams).length + 1} goldens to ${dir}`)
