// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * An Effect UI host with no DOM (spike, `docs/cross-platform-ui.md` phase 1): it keeps the tree as
 * plain nodes and sends what changed in each flush to the SwiftUI shell as a batch of ops. Views stay
 * `Html` with their `data-ui` attributes, so the web keeps drawing them as before.
 *
 * Only what a native renderer reads crosses the bridge: elements, text, `data-ui*` attributes and
 * which events an element handles. Classes, styles and other attributes stay on this side.
 */
import type { Renderer, View } from "@effect/ui"

type Handlers = Readonly<Record<string, View.Handler<unknown, any>>>

export interface NativeElement {
	readonly kind: "element"
	readonly id: number
	readonly tag: string
	readonly attrs: Record<string, string>
	readonly children: Array<NativeNode>
	parent: NativeElement | undefined
	events: { handlers: Handlers; dispatch: Renderer.Dispatch } | undefined
}

export interface NativeText {
	readonly kind: "text"
	readonly id: number
	readonly tag: "#text"
	text: string
	parent: NativeElement | undefined
}

export type NativeNode = NativeElement | NativeText

/**
 * One change, as the shell applies it (`EffectUiTree.swift`). Ids are the host's own; `0` is the
 * container the tree is mounted in.
 */
export type Op =
	| readonly ["element", id: number, tag: string]
	| readonly ["text", id: number, text: string]
	| readonly ["setText", id: number, text: string]
	| readonly ["attr", id: number, name: string, value: string | null]
	| readonly ["insert", parent: number, id: number, before: number | null]
	| readonly ["remove", id: number]
	| readonly ["events", id: number, names: ReadonlyArray<string>]

/** The attributes a native renderer reads (`web-foldkit/src/ui/semantic.ts`). */
const crosses = (name: string) => name === "data-ui" || name === "data-ui-props"

export const makeNativeHost = (send: (ops: ReadonlyArray<Op>) => void) => {
	// The container is the first element made: id 0.
	let nextId = 0
	const nodes = new Map<number, NativeNode>()
	let pending: Array<Op> = []

	const element = (tag: string): NativeElement => {
		const node: NativeElement = {
			kind: "element",
			id: nextId++,
			tag,
			attrs: {},
			children: [],
			parent: undefined,
			events: undefined,
		}
		nodes.set(node.id, node)
		return node
	}

	const detach = (node: NativeNode) => {
		const parent = node.parent
		if (parent === undefined) return
		const index = parent.children.indexOf(node)
		if (index >= 0) parent.children.splice(index, 1)
		node.parent = undefined
	}

	const forget = (node: NativeNode) => {
		nodes.delete(node.id)
		if (node.kind === "element") for (const child of node.children) forget(child)
	}

	const container = element("#container")

	const host: Renderer.Host<NativeNode> = {
		createElement: (tag) => {
			const node = element(tag)
			pending.push(["element", node.id, tag])
			return node
		},
		createText: (text) => {
			const node: NativeText = { kind: "text", id: nextId++, tag: "#text", text, parent: undefined }
			nodes.set(node.id, node)
			pending.push(["text", node.id, text])
			return node
		},
		// A group of nodes placed together: the shell keeps it as an element it reads through.
		createContainer: () => {
			const node = element("#container")
			pending.push(["element", node.id, node.tag])
			return node
		},
		setText: (node, text) => {
			if (node.kind === "element") return
			node.text = text
			pending.push(["setText", node.id, text])
		},
		setAttr: (node, name, value) => {
			if (node.kind === "text") return
			if (value === undefined) delete node.attrs[name]
			else node.attrs[name] = value
			if (crosses(name)) pending.push(["attr", node.id, name, value ?? null])
		},
		setProp: () => {},
		insertBefore: (parent, node, ref) => {
			if (parent.kind === "text") return
			detach(node)
			const index = ref === undefined ? -1 : parent.children.indexOf(ref)
			parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
			node.parent = parent
			pending.push(["insert", parent.id, node.id, ref?.id ?? null])
		},
		remove: (node) => {
			detach(node)
			forget(node)
			pending.push(["remove", node.id])
		},
		parentOf: (node) => node.parent,
		nextOf: (node) => {
			const parent = node.parent
			return parent === undefined ? undefined : parent.children[parent.children.indexOf(node) + 1]
		},
		setEvents: (node, handlers, dispatch) => {
			if (node.kind === "text") return
			const names = Object.keys(handlers).sort()
			const before = node.events === undefined ? [] : Object.keys(node.events.handlers).sort()
			node.events = names.length === 0 ? undefined : { handlers, dispatch }
			if (names.join() !== before.join()) pending.push(["events", node.id, names])
		},
		elements: "any",
		controlled: new Set(),
		runsMounts: false,
		commit: () => {
			if (pending.length === 0) return
			const ops = pending
			pending = []
			send(ops)
		},
	}

	/**
	 * A press from the shell on node `id`: the innermost element at or under it with a handler for
	 * `event` gets it (an item is pressed through its link, as on the web), else the nearest above.
	 */
	const fire = (id: number, event: string, payload: unknown = {}): boolean => {
		const start = nodes.get(id)
		if (start === undefined || start.kind === "text") return false
		const below = (node: NativeElement): NativeElement | undefined => {
			for (const child of node.children) {
				if (child.kind === "text") continue
				const found = below(child)
				if (found !== undefined) return found
			}
			return node.events?.handlers[event] === undefined ? undefined : node
		}
		let target: NativeElement | undefined = below(start)
		for (let node = start.parent; target === undefined && node !== undefined; node = node.parent)
			if (node.events?.handlers[event] !== undefined) target = node
		const handler = target?.events?.handlers[event]
		if (target?.events === undefined || handler === undefined) return false
		return target.events.dispatch(event, handler, payload)
	}

	return { host, container, fire }
}
