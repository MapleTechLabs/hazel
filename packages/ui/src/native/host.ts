// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The native host (G1): a DOM-less `Renderer.Host` for the `hazel` vocabulary that keeps plain nodes
 * and sends each flush to Swift as one wire batch (`wire.ts`). Props cross as JSON, deduped by value.
 */
import { Renderer, type View } from "@effect/ui"
import { Layer } from "effect"
import { Hazel } from "../vocabulary/index.ts"
import { type Batch, type Json, type Op, WIRE_VERSION } from "./wire.ts"

type Handlers = Readonly<Record<string, View.Handler<unknown, any>>>

export interface NativeNode {
	readonly id: number
	readonly tag: string
	readonly children: Array<NativeNode>
	parent: NativeNode | undefined
	text: string
	/** The JSON of each prop as last sent, for dedupe. */
	readonly sent: Map<string, string>
	events: { readonly handlers: Handlers; readonly dispatch: Renderer.Dispatch } | undefined
}

export interface NativeHost {
	readonly host: Renderer.Host<NativeNode>
	readonly container: NativeNode
	/** An event from Swift on node `id`: its own handler, else the nearest ancestor's. */
	readonly fire: (id: number, event: string, payload?: Json) => boolean
	readonly nodes: ReadonlyMap<number, NativeNode>
	/** The Layer to mount with: the `Renderer` and the vocabulary's (stubbed) `Hazel.Host`. */
	readonly layer: Layer.Layer<Renderer.Renderer | Hazel.Host>
}

export const makeNativeHost = (send: (batch: Batch) => void): NativeHost => {
	let nextId = 0
	let seq = 0
	let pending: Array<Op> = []
	let scheduled = false
	const nodes = new Map<number, NativeNode>()

	const node = (tag: string): NativeNode => {
		const made: NativeNode = {
			id: nextId++,
			tag,
			children: [],
			parent: undefined,
			text: "",
			sent: new Map(),
			events: undefined,
		}
		nodes.set(made.id, made)
		return made
	}

	const flush = () => {
		if (pending.length === 0) return
		const ops = pending
		pending = []
		send({ v: WIRE_VERSION, seq: ++seq, ops })
	}

	// Ops outside a flush (a failure's fallback placed between flushes) go on our own next microtask.
	const push = (op: Op) => {
		pending.push(op)
		if (scheduled) return
		scheduled = true
		queueMicrotask(() => {
			scheduled = false
			flush()
		})
	}

	const unlink = (child: NativeNode) => {
		const parent = child.parent
		if (parent === undefined) return
		const index = parent.children.indexOf(child)
		if (index >= 0) parent.children.splice(index, 1)
		child.parent = undefined
	}

	const forget = (gone: NativeNode) => {
		nodes.delete(gone.id)
		for (const child of gone.children) forget(child)
	}

	const container = node("#root")

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
		// A kept-alive child's nodes: G1 creates the container but never sends `detach` (stubbed).
		createContainer: () => {
			const made = node("#container")
			push(["create", made.id, "#container"])
			return made
		},
		setText: (target, text) => {
			if (target.text === text) return
			target.text = text
			push(["text", target.id, text])
		},
		// `hazel` elements carry no attributes; `Html` is not on this host.
		setAttr: () => {},
		setProp: (target, name, value) => {
			const json = value === undefined ? "null" : JSON.stringify(value)
			if (target.sent.get(name) === json) return
			if (json === "null") target.sent.delete(name)
			else target.sent.set(name, json)
			const parsed = JSON.parse(json) as Json
			const last = pending[pending.length - 1]
			// The renderer sets one element's props together: they share one `props` op.
			if (last !== undefined && last[0] === "props" && last[1] === target.id) {
				pending[pending.length - 1] = ["props", target.id, { ...last[2], [name]: parsed }]
			} else push(["props", target.id, { [name]: parsed }])
		},
		insertBefore: (parent, child, ref) => {
			unlink(child)
			const index = ref === undefined ? -1 : parent.children.indexOf(ref)
			parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
			child.parent = parent
			push(["insert", parent.id, child.id, ref?.id ?? null])
		},
		remove: (gone) => {
			unlink(gone)
			forget(gone)
			push(["remove", gone.id])
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

	const fire = (id: number, event: string, payload: Json = {}): boolean => {
		for (let at = nodes.get(id); at !== undefined; at = at.parent) {
			const handler = at.events?.handlers[event]
			if (handler !== undefined && at.events !== undefined) return at.events.dispatch(event, handler, payload)
		}
		return false
	}

	const commands: Hazel.Host["Service"] = {
		// G1 stub: commands become `command` ops with replies (lane B).
		focus: () => {},
		scrollTo: () => {},
	}

	const layer = Layer.mergeAll(Renderer.layer(host), Layer.succeed(Hazel.Host, commands))
	return { host, container, fire, nodes, layer }
}
