/// <reference types="vite/client" />
/**
 * The web's primitive registry (C0): every `primitives/<group>/<tag>.ts` that exports `primitive`,
 * found by file glob, so a lane adds a renderer without editing a shared list. A `hazel` tag with no
 * renderer yet throws `NotImplemented` naming the lane that owns it.
 */
import { keyOf, notOnWeb, type TagKey } from "../vocabulary/spec.ts"
import type { Primitive, WebPrimitive } from "./primitives/define.ts"
import { dispose } from "./extensions.ts"

export type { Events, Primitive } from "./primitives/define.ts"

const modules = import.meta.glob<{ readonly primitive?: WebPrimitive }>("./primitives/*/*.ts", {
	eager: true,
})

const registry = new Map<TagKey, WebPrimitive>()
/** Each live primitive by its outer node: the host's commands and removal reach it here. */
const live = new WeakMap<Node, Primitive>()

/** The primitive whose outer node is `node`, if it is one. */
export const primitiveOf = (node: Node): Primitive | undefined => live.get(node)
for (const [path, module] of Object.entries(modules)) {
	const found = module.primitive
	if (found === undefined) continue
	if (registry.has(found.key)) throw new Error(`two web renderers for hz:${found.key} (${path})`)
	registry.set(found.key, found)
}

/** The tags the web draws today (a stub does not count). */
export const implemented = (): ReadonlyArray<TagKey> =>
	[...registry.values()].filter((found) => found.stub !== true).map((found) => found.key)

/** Whether the web draws `key` for real (not a stub, not missing). */
export const isImplemented = (key: TagKey): boolean => {
	const found = registry.get(key)
	return found !== undefined && found.stub !== true
}

/** The DOM for `tag`; undefined for a tag that is not `hazel` (the browser host takes it). */
export const create = (document: Document, tag: string): Primitive | undefined => {
	const key = keyOf(tag)
	if (key === undefined) return undefined
	const renderer = registry.get(key)
	if (renderer === undefined) throw notOnWeb(key)
	const outer = (tagName: string) => {
		const node = document.createElement(tagName)
		node.dataset.hz = key
		return node
	}
	const self = (node: HTMLElement, set: Primitive["set"]): Primitive => ({
		tag,
		outer: node,
		content: node,
		set,
		events: undefined,
	})
	const primitive = renderer.create({ document, tag, outer, self })
	live.set(primitive.outer, primitive)
	return primitive
}

/** Before a subtree leaves: ends the extension instances in it and disposes its primitives. */
export const release = (node: Node) => {
	if (!(node instanceof Element)) return
	for (const element of [node, ...node.querySelectorAll("[data-hz]")]) {
		const primitive = live.get(element)
		if (primitive === undefined) continue
		live.delete(element)
		primitive.dispose?.()
	}
	const all = node.matches("[data-hz=ext]") ? [node] : []
	for (const ext of [...all, ...node.querySelectorAll("[data-hz=ext]")]) {
		const surface = ext.querySelector(":scope > [data-hz-part=surface]")
		if (surface !== null) dispose(surface)
	}
}
