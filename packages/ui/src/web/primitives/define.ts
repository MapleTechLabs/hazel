/**
 * What each `hz:*` tag is in the DOM (C0). Structure is built once at create time with one content
 * parent for the renderer's children; props later only change attributes, text and internal swaps.
 * Each renderer is a file `primitives/<group>/<tag>.ts` exporting `primitive` (the glob registry).
 */
import type { TagKey } from "../../vocabulary/spec.ts"

export interface Events {
	readonly handlers: Readonly<Record<string, unknown>>
	readonly dispatch: (event: string, handler: any, payload: unknown) => boolean
}

/** One `hz:*` element: its outer node, the node its children go in, and how it applies a prop. */
export interface Primitive {
	readonly tag: string
	readonly outer: HTMLElement
	readonly content: HTMLElement
	readonly set: (name: string, value: unknown) => void
	events: Events | undefined
}

export interface Context {
	readonly document: Document
	readonly tag: string
	/** The primitive's outer node, `data-hz=<key>`. */
	readonly outer: (tagName: string) => HTMLElement
	/** A primitive whose outer node is its content parent. */
	readonly self: (node: HTMLElement, set: Primitive["set"]) => Primitive
}

export interface WebPrimitive {
	readonly key: TagKey
	readonly create: (context: Context) => Primitive
}

export const definePrimitive = (key: TagKey, create: (context: Context) => Primitive): WebPrimitive => ({
	key,
	create,
})

export const part = (document: Document, tagName: string, name: string) => {
	const node = document.createElement(tagName)
	node.dataset.hzPart = name
	return node
}

/** A boolean option as `data-<name>`. */
export const flag = (node: HTMLElement, name: string, value: unknown) => {
	if (value === true) node.setAttribute(`data-${name}`, "")
	else node.removeAttribute(`data-${name}`)
}

/** A closed option as `data-<name>=<value>`. */
export const option = (node: HTMLElement, name: string, value: unknown) => {
	if (typeof value === "string") node.setAttribute(`data-${name}`, value)
	else node.removeAttribute(`data-${name}`)
}
