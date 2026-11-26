/**
 * A reference model of what Swift's `Tree` does with batches (C2): the goldens' `tree` outlines are
 * checked against it here and against `HazelUI/Tree` in Swift, so both apply ops the same way.
 */
import { type Batch, describe, type Json, type Op, WireError } from "./wire.ts"

interface Node {
	readonly id: number
	readonly tag: string
	props: Record<string, Json>
	text: string
	children: Array<number>
	events: ReadonlyArray<string>
	parent: number | undefined
}

export class Tree {
	private readonly nodes = new Map<number, Node>([[0, this.make(0, "#root")]])
	readonly detached = new Set<number>()
	lastSeq = 0

	private make(id: number, tag: string): Node {
		return { id, tag, props: {}, text: "", children: [], events: [], parent: undefined }
	}

	get count(): number {
		return this.nodes.size
	}

	has(id: number): boolean {
		return this.nodes.has(id)
	}

	apply(batch: Batch): void {
		if (batch.seq !== this.lastSeq + 1)
			throw new WireError(`out of order: expected ${this.lastSeq + 1}, got ${batch.seq}`)
		for (const op of batch.ops) this.applyOp(op)
		this.lastSeq = batch.seq
	}

	private lookup(id: number): Node {
		const node = this.nodes.get(id)
		if (node === undefined) throw new WireError(`unknown node ${id}`)
		return node
	}

	private unlink(node: Node): void {
		this.detached.delete(node.id)
		if (node.parent === undefined) return
		const parent = this.nodes.get(node.parent)
		if (parent !== undefined) parent.children = parent.children.filter((child) => child !== node.id)
		node.parent = undefined
	}

	private free(node: Node): void {
		for (const child of node.children) {
			const found = this.nodes.get(child)
			if (found !== undefined) this.free(found)
		}
		this.nodes.delete(node.id)
		this.detached.delete(node.id)
	}

	private applyOp(op: Op): void {
		switch (op[0]) {
			case "create":
				if (this.nodes.has(op[1])) throw new WireError(`duplicate node ${op[1]}`)
				this.nodes.set(op[1], this.make(op[1], op[2]))
				return
			case "props": {
				const node = this.lookup(op[1])
				for (const [key, value] of Object.entries(op[2])) {
					if (value === null) delete node.props[key]
					else node.props[key] = value
				}
				return
			}
			case "text":
				this.lookup(op[1]).text = op[2]
				return
			case "insert": {
				const parent = this.lookup(op[1])
				const child = this.lookup(op[2])
				this.unlink(child)
				const at = op[3] === null ? -1 : parent.children.indexOf(op[3])
				parent.children.splice(at < 0 ? parent.children.length : at, 0, child.id)
				child.parent = parent.id
				return
			}
			case "remove": {
				const node = this.lookup(op[1])
				this.unlink(node)
				this.free(node)
				return
			}
			case "events":
				this.lookup(op[1]).events = [...op[2]]
				return
			case "detach": {
				const node = this.lookup(op[1])
				this.unlink(node)
				this.detached.add(node.id)
				return
			}
			case "command":
				// Not a tree change: the host answers it with a `reply`.
				this.lookup(op[2])
				return
		}
	}

	/** The tree under `id`, one node per line, as Swift's `Tree.outline` prints it. */
	outline(id = 0, depth = 0): ReadonlyArray<string> {
		const node = this.nodes.get(id)
		if (node === undefined) return []
		let line = `${"  ".repeat(depth)}${node.tag}#${node.id}`
		const keys = Object.keys(node.props).sort()
		if (keys.length > 0)
			line += ` {${keys.map((key) => `${key}=${describe(node.props[key]!)}`).join(",")}}`
		if (node.text !== "") line += ` "${node.text}"`
		if (node.events.length > 0) line += ` on[${[...node.events].sort().join(",")}]`
		return [line, ...node.children.flatMap((child) => this.outline(child, depth + 1))]
	}
}
