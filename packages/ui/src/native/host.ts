// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The native host: a DOM-less `Renderer.Host` for the `hazel` vocabulary that keeps plain nodes and
 * sends each flush to Swift as one wire batch (`wire.ts`). Inbound `fire` and `reply` messages arrive
 * through `receive` (Swift's `__hazel.receive(json)`); `Hazel.Host` commands resolve on their reply.
 */
import { Renderer, type View } from "@effect/ui"
import { Effect, Layer, Schema } from "effect"
import { Hazel, Spec } from "../vocabulary/index.ts"
import * as Revisions from "./revisions.ts"
import {
	type Batch,
	type CommandName,
	decodeInbound,
	type Inbound,
	type Json,
	type Op,
	WIRE_VERSION,
	WireError,
} from "./wire.ts"

type Handlers = Readonly<Record<string, View.Handler<unknown, any>>>

export interface NativeNode extends Hazel.HostNode {
	readonly id: number
	readonly tag: string
	readonly children: Array<NativeNode>
	parent: NativeNode | undefined
	text: string
	/** The canonical JSON of each prop as last sent, for dedupe. */
	readonly sent: Map<string, string>
	events: { readonly handlers: Handlers; readonly dispatch: Renderer.Dispatch } | undefined
	/** False once freed: its id is never reused, so a late event or command on it is dropped. */
	live: boolean
	/** Its parent in Swift's tree as last sent; undefined while detached or never inserted. */
	wireParent: NativeNode | undefined
}

/** A command Swift answered with `ok: false`, or one on a node the host no longer has. */
export class CommandFailed extends Schema.TaggedError<CommandFailed>()("CommandFailed", {
	command: Schema.String,
	reason: Schema.String,
}) {
	override get message() {
		return `native ${this.command} failed: ${this.reason}`
	}
}

export interface NativeHostOptions {
	/** Extensions whose props are encoded and whose events are decoded with their Schemas. */
	readonly extensions?: ReadonlyArray<Hazel.AnyExtension>
}

export interface NativeHost {
	readonly host: Renderer.Host<NativeNode>
	readonly container: NativeNode
	/** An event from Swift on node `id`: its own handler, else the nearest ancestor's. */
	readonly fire: (id: number, event: string, payload?: Json) => boolean
	/** `__hazel.receive(json)`: one inbound message (`["fire", ...]` or `["reply", ...]`). */
	readonly receive: (json: string) => void
	/**
	 * Many inbound messages in one JS turn, as one JSON array of messages: their updates render in
	 * one flush, so Swift gets one batch (G4: separate turns cost about 0.45 ms each).
	 */
	readonly receiveMany: (json: string) => void
	/** Live nodes by id; a removed subtree leaves it at once. */
	readonly nodes: ReadonlyMap<number, NativeNode>
	/** Commands sent and not yet answered, by request id. */
	readonly pendingCommands: () => number
	/** The Layer to mount with: the `Renderer` and the vocabulary's `Hazel.Host`. */
	readonly layer: Layer.Layer<Renderer.Renderer | Hazel.Host>
}

// Canonical JSON (what `JSON.stringify` writes, keys sorted): equal values dedupe in any key order.
const canonical = (value: unknown): string => {
	if (value === null || value === undefined || typeof value === "function" || typeof value === "symbol")
		return "null"
	if (typeof value !== "object") return JSON.stringify(value) ?? "null"
	if ("toJSON" in value && typeof value.toJSON === "function") {
		const json: unknown = value.toJSON()
		return canonical(json)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
	const entries = Object.entries(value)
		.filter(([, item]) => item !== undefined && typeof item !== "function" && typeof item !== "symbol")
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
	return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`
}

const isRect = (value: Json): value is Json & Hazel.Rect =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	["x", "y", "width", "height"].every((key) => Number.isFinite((value as Record<string, Json>)[key]))

export const makeNativeHost = (send: (batch: Batch) => void, options: NativeHostOptions = {}): NativeHost => {
	let nextId = 0
	let seq = 0
	let pending: Array<Op> = []
	let scheduled = false
	const nodes = new Map<number, NativeNode>()
	const extensions = new Map((options.extensions ?? []).map((ext) => [ext.name, ext]))

	const node = (tag: string, register = true): NativeNode => {
		const made: NativeNode = {
			id: nextId++,
			tag,
			children: [],
			parent: undefined,
			text: "",
			sent: new Map(),
			events: undefined,
			live: true,
			wireParent: undefined,
		}
		if (register) nodes.set(made.id, made)
		return made
	}

	// `remove` is the renderer's removeChild: a kept child's nodes are removed, then parked in a
	// container. So a node is freed at the end of the flush, if nothing placed it again by then.
	const removed = new Set<NativeNode>()
	const freeRemoved = () => {
		for (const gone of removed) {
			let covered = false
			for (let at = gone.wireParent; at !== undefined && !covered; at = at.wireParent)
				covered = removed.has(at)
			// Swift frees a subtree with its root: one `remove` for the topmost removed node.
			if (!covered && gone.live) pending.push(["remove", gone.id])
		}
		for (const gone of removed) forget(gone)
		removed.clear()
	}

	const flush = () => {
		freeRemoved()
		if (pending.length === 0) return
		const ops = pending
		pending = []
		send({ v: WIRE_VERSION, seq: ++seq, ops })
	}

	// Ops outside a flush (a failure's fallback placed between flushes, a command) go on our own
	// next microtask; a `commit` before it sends them with the flush and leaves it nothing to do.
	const schedule = () => {
		if (scheduled) return
		scheduled = true
		queueMicrotask(() => {
			scheduled = false
			flush()
		})
	}
	const push = (op: Op) => {
		pending.push(op)
		schedule()
	}

	const unlink = (child: NativeNode) => {
		const parent = child.parent
		if (parent === undefined) return
		const index = parent.children.indexOf(child)
		if (index >= 0) parent.children.splice(index, 1)
		child.parent = undefined
	}

	// Frees a removed subtree: out of `nodes`, handlers and revisions dropped.
	const forget = (gone: NativeNode) => {
		nodes.delete(gone.id)
		gone.live = false
		gone.wireParent = undefined
		gone.events = undefined
		textRevs.delete(gone)
		extArgs.delete(gone)
		extNames.delete(gone)
		for (const child of gone.children) {
			child.parent = undefined
			forget(child)
		}
		gone.children.length = 0
	}

	const container = node("#root")

	// ---------------------------------------------------------------------------
	// props: deduped by canonical JSON, controlled values never back in revision (G5)
	// ---------------------------------------------------------------------------

	const controlledByTag = new Map<string, ReadonlySet<string>>()
	const controlledOf = (tag: string): ReadonlySet<string> => {
		let found = controlledByTag.get(tag)
		if (found === undefined) {
			const key = tag.slice(3)
			found = new Set(
				tag.startsWith("hz:") && key in Spec.tags ? Spec.controlledProps(key as Spec.TagKey) : [],
			)
			controlledByTag.set(tag, found)
		}
		return found
	}

	// The last revision pair sent per controlled prop; an older one is dropped, not sent.
	const textRevs = new Map<NativeNode, Map<string, Revisions.Incoming>>()
	const staleRevision = (target: NativeNode, name: string, value: unknown): boolean => {
		if (!controlledOf(target.tag).has(name)) return false
		const revs = textRevs.get(target) ?? new Map<string, Revisions.Incoming>()
		textRevs.set(target, revs)
		const incoming = Revisions.decode(value)
		if (incoming === undefined) {
			revs.delete(name)
			return false
		}
		const last = revs.get(name)
		if (
			last !== undefined &&
			(incoming.edit < last.edit || (incoming.edit === last.edit && incoming.rev < last.rev))
		)
			return true
		revs.set(name, incoming)
		return false
	}

	// An extension's `args` cross encoded with its props Schema, once its `ext` name is known.
	const extArgs = new Map<NativeNode, unknown>()
	const extNames = new Map<NativeNode, string>()
	const definitionOf = (target: NativeNode) => {
		const name = extNames.get(target)
		return name === undefined ? undefined : extensions.get(name)
	}
	const sendArgs = (target: NativeNode) => {
		const value = extArgs.get(target)
		const definition = definitionOf(target)
		if (definition === undefined || value === undefined) return sendProp(target, "args", value)
		try {
			sendProp(target, "args", Schema.encodeUnknownSync(definition.props)(value))
		} catch (error) {
			console.error(`[native] ${definition.name} props do not encode`, error)
		}
	}

	const sendProp = (target: NativeNode, name: string, value: unknown) => {
		if (value === undefined && !target.sent.has(name)) return
		const json = value === undefined ? "null" : canonical(value)
		if (target.sent.get(name) === json) return
		if (staleRevision(target, name, value)) return
		if (json === "null") target.sent.delete(name)
		else target.sent.set(name, json)
		// SAFETY: `json` is `JSON.stringify` output, so it parses back to JSON.
		const parsed = JSON.parse(json) as Json
		const last = pending[pending.length - 1]
		// The renderer sets one element's props together: they share one `props` op.
		if (last !== undefined && last[0] === "props" && last[1] === target.id) {
			pending[pending.length - 1] = ["props", target.id, { ...last[2], [name]: parsed }]
		} else push(["props", target.id, { [name]: parsed }])
	}

	const setProp = (target: NativeNode, name: string, value: unknown) => {
		if (target.tag !== "hz:ext") return sendProp(target, name, value)
		if (name === "args") {
			extArgs.set(target, value)
			return sendArgs(target)
		}
		sendProp(target, name, value)
		if (name !== "ext") return
		if (typeof value === "string") extNames.set(target, value)
		else extNames.delete(target)
		// The name arrived after the args: send them again, now encoded.
		if (extArgs.has(target)) sendArgs(target)
	}

	// ---------------------------------------------------------------------------
	// the Renderer.Host
	// ---------------------------------------------------------------------------

	const host: Renderer.Host<NativeNode> = {
		createElement: (tag) => {
			const made = node(tag)
			push(["create", made.id, tag])
			return made
		},
		createText: (text) => {
			const made = node("#text")
			made.text = text
			push(["create", made.id, "#text"])
			push(["text", made.id, text])
			return made
		},
		// A kept child's nodes park here. It stays on this side: placing a node in it is a `detach`.
		createContainer: () => node("#container", false),
		setText: (target, text) => {
			if (target.text === text) return
			target.text = text
			push(["text", target.id, text])
		},
		// `hazel` elements carry no attributes; `Html` is not on this host.
		setAttr: () => {},
		setProp,
		insertBefore: (parent, child, ref) => {
			unlink(child)
			const index = ref === undefined ? -1 : parent.children.indexOf(ref)
			parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
			child.parent = parent
			removed.delete(child)
			if (parent.tag === "#container") {
				child.wireParent = undefined
				push(["detach", child.id])
			} else {
				child.wireParent = parent
				push(["insert", parent.id, child.id, ref?.id ?? null])
			}
		},
		remove: (gone) => {
			unlink(gone)
			if (!gone.live) return
			removed.add(gone)
			schedule()
		},
		parentOf: (child) => child.parent,
		nextOf: (child) => {
			const parent = child.parent
			return parent === undefined ? undefined : parent.children[parent.children.indexOf(child) + 1]
		},
		setEvents: (target, handlers, dispatch) => {
			const names = Object.keys(handlers).sort()
			const before = target.events === undefined ? [] : Object.keys(target.events.handlers).sort()
			target.events = names.length === 0 ? undefined : { handlers, dispatch }
			if (names.join() !== before.join()) push(["events", target.id, names])
		},
		elements: [Hazel.name],
		controlled: new Set(),
		runsMounts: false,
		commit: flush,
	}

	// ---------------------------------------------------------------------------
	// inbound: events and replies
	// ---------------------------------------------------------------------------

	// An extension's own event is decoded with its Schema; a payload that does not decode is dropped.
	const decodeEvent = (
		at: NativeNode,
		event: string,
		payload: Json,
	): { readonly ok: boolean; value: unknown } => {
		if (at.tag !== "hz:ext") return { ok: true, value: payload }
		const schema = definitionOf(at)?.events[event]
		if (schema === undefined) return { ok: true, value: payload }
		try {
			// SAFETY: an extension's event Schemas decode wire JSON and need no services.
			const codec = schema as Schema.Codec<unknown, unknown>
			return { ok: true, value: Schema.decodeUnknownSync(codec)(payload) }
		} catch (error) {
			console.error(`[native] ${event} payload does not decode`, error)
			return { ok: false, value: undefined }
		}
	}

	const fire = (id: number, event: string, payload: Json = {}): boolean => {
		for (let at = nodes.get(id); at !== undefined; at = at.parent) {
			const events = at.events
			const handler = events?.handlers[event]
			if (handler === undefined || events === undefined) continue
			const decoded = decodeEvent(at, event, payload)
			return decoded.ok && events.dispatch(event, handler, decoded.value)
		}
		return false
	}

	const waiting = new Map<number, (ok: boolean, result: Json) => void>()
	let nextRequest = 1

	const handle = (message: Inbound) => {
		if (message[0] === "fire") {
			fire(message[1], message[2], message[3])
			return
		}
		const resolve = waiting.get(message[1])
		// A reply to a command interrupted meanwhile has no one waiting: dropped.
		if (resolve === undefined) return
		waiting.delete(message[1])
		resolve(message[2], message[3])
	}

	const parse = (json: string): Json => {
		try {
			// SAFETY: `JSON.parse` returns JSON; `decodeInbound` checks its shape.
			return JSON.parse(json) as Json
		} catch {
			throw new WireError("inbound is not JSON")
		}
	}
	const receive = (json: string) => handle(decodeInbound(parse(json)))
	const receiveMany = (json: string) => {
		const messages = parse(json)
		if (!Array.isArray(messages)) throw new WireError("inbound list is not an array")
		for (const message of messages) handle(decodeInbound(message))
	}

	// ---------------------------------------------------------------------------
	// commands: a `command` op each, resolved by its `reply`
	// ---------------------------------------------------------------------------

	const command = (target: Hazel.HostNode, name: CommandName, args: Json) =>
		Effect.callback<Json, CommandFailed>((resume) => {
			const at = target as NativeNode
			if (nodes.get(at.id) !== at) {
				resume(Effect.fail(new CommandFailed({ command: name, reason: "the node is not mounted" })))
				return
			}
			const request = nextRequest++
			waiting.set(request, (ok, result) =>
				resume(
					ok
						? Effect.succeed(result)
						: Effect.fail(
								new CommandFailed({
									command: name,
									reason: typeof result === "string" ? result : JSON.stringify(result),
								}),
							),
				),
			)
			push(["command", request, at.id, name, args])
			return Effect.sync(() => waiting.delete(request))
		})

	// A focus or scroll that fails is not the screen's error: it is logged and the command completes.
	const effect = (target: Hazel.HostNode, name: CommandName, args: Json) =>
		command(target, name, args).pipe(
			Effect.asVoid,
			Effect.catchTag("CommandFailed", (error) => Effect.logWarning(error.message)),
		)

	const commands: Hazel.Host["Service"] = {
		focus: (target) => effect(target, "focus", null),
		blur: (target) => effect(target, "blur", null),
		scrollTo: (target, to) => effect(target, "scrollTo", to),
		select: (target, range) => effect(target, "select", { start: range.start, end: range.end }),
		// A measure has no value to fall back on: a failure, or a reply that is not a rect, is a defect.
		measure: (target) =>
			command(target, "measure", null).pipe(
				Effect.flatMap((result) =>
					isRect(result)
						? Effect.succeed({
								x: result.x,
								y: result.y,
								width: result.width,
								height: result.height,
							})
						: Effect.fail(
								new CommandFailed({ command: "measure", reason: "the reply is not a rect" }),
							),
				),
				Effect.orDie,
			),
	}

	const layer = Layer.mergeAll(Renderer.layer(host), Layer.succeed(Hazel.Host, commands))
	return {
		host,
		container,
		fire,
		receive,
		receiveMany,
		nodes,
		pendingCommands: () => waiting.size,
		layer,
	}
}
