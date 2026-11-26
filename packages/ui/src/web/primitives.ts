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
for (const [path, module] of Object.entries(modules)) {
	const found = module.primitive
	if (found === undefined) continue
	if (registry.has(found.key)) throw new Error(`two web renderers for hz:${found.key} (${path})`)
	registry.set(found.key, found)
}

/** The tags the web draws today. */
export const implemented = (): ReadonlyArray<TagKey> => [...registry.keys()]

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
	return renderer.create({ document, tag, outer, self })
}

/** Before a subtree leaves: ends the extension instances in it. */
export const release = (node: Node) => {
	if (!(node instanceof Element)) return
	const all = node.matches("[data-hz=ext]") ? [node] : []
	for (const ext of [...all, ...node.querySelectorAll("[data-hz=ext]")]) {
		const surface = ext.querySelector(":scope > [data-hz-part=surface]")
		if (surface !== null) dispose(surface)
	}
}
