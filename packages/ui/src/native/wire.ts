/**
 * The native wire, v2 (contract C2, `docs/hazel-ui.md` "Native host and the wire"): the single source.
 * `HazelUI/Sources/HazelUI/Wire/Wire.swift` mirrors it by hand; the goldens in `__goldens__/` are decoded
 * by both (`wire.test.ts`, `GoldenTests.swift`) to the same canonical text (`describeOp`).
 *
 * Delivery: one batch per flush, `JSON.stringify(batch)` handed to `__native.post`; Swift reads the JS
 * string as UTF-8 bytes (`JSStringGetUTF8CString`, never through `String`) and decodes those bytes.
 * Inbound messages go the other way as one JSON array each, to `__hazel.receive(json)`.
 */

export const WIRE_VERSION = 2

export type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json }

/** Imperative requests (`spec.commandNames`); each gets exactly one `reply`. */
export const commandNames = ["focus", "blur", "scrollTo", "measure", "select"] as const
export type CommandName = (typeof commandNames)[number]

/**
 * Ids are the host's; 0 is the root container. A text node is `create` with tag `#text`, a kept-alive
 * container `#container`. `props` carries only changed keys and `null` deletes one; a `controlled` prop
 * (`value {text, rev, edit}`) never goes back in revision. `remove` frees the whole subtree; `insert` of
 * an existing or detached id moves it; `detach` takes a subtree out of the tree and keeps it alive.
 */
export type Op =
	| readonly ["create", id: number, tag: string]
	| readonly ["props", id: number, changed: { readonly [name: string]: Json }]
	| readonly ["text", id: number, text: string]
	| readonly ["insert", parent: number, id: number, before: number | null]
	| readonly ["remove", id: number]
	| readonly ["events", id: number, names: ReadonlyArray<string>]
	| readonly ["detach", id: number]
	| readonly ["command", request: number, id: number, name: CommandName, args: Json]

export const opNames = ["create", "props", "text", "insert", "remove", "events", "detach", "command"] as const

/** One flush. `seq` is exactly the previous plus one; Swift rejects a gap and an unknown `v`. */
export interface Batch {
	readonly v: typeof WIRE_VERSION
	readonly seq: number
	readonly ops: ReadonlyArray<Op>
}

/**
 * Swift to JS: an event on a node (with the last `seq` Swift applied, so JS can tell an event raised
 * on a tree it has since changed), or a command's one reply (`ok` false carries an error message).
 */
export type Inbound =
	| readonly ["fire", id: number, event: string, payload: Json, seq: number]
	| readonly ["reply", request: number, ok: boolean, result: Json]

export class WireError extends Error {
	override readonly name = "WireError"
}

// ---------------------------------------------------------------------------
// encoding and decoding
// ---------------------------------------------------------------------------

export const encode = (message: Batch | Inbound): string => JSON.stringify(message)

const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value)
const isRecord = (value: unknown): value is { readonly [key: string]: Json } =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const field = <T>(op: ReadonlyArray<unknown>, index: number, check: (value: unknown) => value is T): T => {
	const value = op[index]
	if (!check(value)) throw new WireError(`${String(op[0])}: field ${index}`)
	return value
}
const isString = (value: unknown): value is string => typeof value === "string"
const isStrings = (value: unknown): value is ReadonlyArray<string> =>
	Array.isArray(value) && value.every(isString)
const isBefore = (value: unknown): value is number | null =>
	value === null || value === undefined || isInt(value)
const isCommand = (value: unknown): value is CommandName =>
	typeof value === "string" && (commandNames as ReadonlyArray<string>).includes(value)
const isJson = (_value: unknown): _value is Json => true

const decodeOp = (raw: unknown): Op => {
	if (!Array.isArray(raw) || typeof raw[0] !== "string") throw new WireError("op is not [name, ...]")
	const op: ReadonlyArray<unknown> = raw
	switch (op[0]) {
		case "create":
			return ["create", field(op, 1, isInt), field(op, 2, isString)]
		case "props":
			return ["props", field(op, 1, isInt), field(op, 2, isRecord)]
		case "text":
			return ["text", field(op, 1, isInt), field(op, 2, isString)]
		case "insert":
			return ["insert", field(op, 1, isInt), field(op, 2, isInt), field(op, 3, isBefore) ?? null]
		case "remove":
			return ["remove", field(op, 1, isInt)]
		case "events":
			return ["events", field(op, 1, isInt), field(op, 2, isStrings)]
		case "detach":
			return ["detach", field(op, 1, isInt)]
		case "command":
			return [
				"command",
				field(op, 1, isInt),
				field(op, 2, isInt),
				field(op, 3, isCommand),
				field(op, 4, isJson) ?? null,
			]
		default:
			throw new WireError(`unknown op ${op[0]}`)
	}
}

/** Validates a parsed batch the way Swift's `WireDecoder` does. */
export const decodeBatch = (raw: unknown): Batch => {
	if (!isRecord(raw)) throw new WireError("batch is not an object")
	if (!isInt(raw.v)) throw new WireError("missing v")
	if (raw.v !== WIRE_VERSION) throw new WireError(`unsupported version ${raw.v}`)
	if (!isInt(raw.seq)) throw new WireError("missing seq")
	if (!Array.isArray(raw.ops)) throw new WireError("missing ops")
	return { v: WIRE_VERSION, seq: raw.seq, ops: raw.ops.map(decodeOp) }
}

export const decodeInbound = (raw: unknown): Inbound => {
	if (!Array.isArray(raw)) throw new WireError("inbound is not [kind, ...]")
	const message: ReadonlyArray<unknown> = raw
	if (message[0] === "fire")
		return [
			"fire",
			field(message, 1, isInt),
			field(message, 2, isString),
			(message[3] ?? {}) as Json,
			field(message, 4, isInt),
		]
	if (message[0] === "reply")
		return [
			"reply",
			field(message, 1, isInt),
			field(message, 2, (v): v is boolean => typeof v === "boolean"),
			(message[3] ?? null) as Json,
		]
	throw new WireError(`unknown inbound ${String(message[0])}`)
}

// ---------------------------------------------------------------------------
// canonical text: what both sides print for the same message (the goldens' `ops` and `inbound`)
// ---------------------------------------------------------------------------

/** A value as `Tree.describe` prints it in Swift: keys sorted, strings quoted as is. */
export const describe = (value: Json): string => {
	if (value === null) return "null"
	if (typeof value === "boolean") return String(value)
	if (typeof value === "number") return String(value)
	if (typeof value === "string") return `"${value}"`
	if (Array.isArray(value)) return `[${value.map(describe).join(",")}]`
	const record = value as { readonly [key: string]: Json }
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${key}:${describe(record[key]!)}`)
		.join(",")}}`
}

const describeProps = (changed: { readonly [name: string]: Json }) =>
	`{${Object.keys(changed)
		.sort()
		.map((key) => `${key}=${describe(changed[key]!)}`)
		.join(",")}}`

export const describeOp = (op: Op): string => {
	switch (op[0]) {
		case "create":
			return `create ${op[1]} ${op[2]}`
		case "props":
			return `props ${op[1]} ${describeProps(op[2])}`
		case "text":
			return `text ${op[1]} "${op[2]}"`
		case "insert":
			return `insert ${op[1]} ${op[2]} ${op[3] ?? "null"}`
		case "remove":
			return `remove ${op[1]}`
		case "events":
			return `events ${op[1]} [${op[2].join(",")}]`
		case "detach":
			return `detach ${op[1]}`
		case "command":
			return `command ${op[1]} ${op[2]} ${op[3]} ${describe(op[4])}`
	}
}

export const describeInbound = (message: Inbound): string =>
	message[0] === "fire"
		? `fire ${message[1]} ${message[2]} ${describe(message[3])} ${message[4]}`
		: `reply ${message[1]} ${message[2]} ${describe(message[3])}`
