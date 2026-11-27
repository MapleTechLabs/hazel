/**
 * What each `hz:*` tag is in the DOM (C0). Structure is built once at create time with one content
 * parent for the renderer's children; props later only change attributes, text and internal swaps.
 * Each renderer is a file `primitives/<group>/<tag>.ts` exporting `primitive` (the glob registry).
 */
import type { Json } from "../../native/wire.ts"
import { tags, type TagKey } from "../../vocabulary/spec.ts"

/** A prop value or event payload: plain data, as the vocabulary's schemas define it. */
export type Plain = Json

export interface Events {
	readonly handlers: Readonly<Record<string, unknown>>
	readonly dispatch: (event: string, handler: any, payload: Plain) => boolean
}

/** One `hz:*` element: its outer node, the node its children go in, and how it applies a prop. */
export interface Primitive {
	readonly tag: string
	readonly outer: HTMLElement
	readonly content: HTMLElement
	readonly set: (name: string, value: Plain) => void
	events: Events | undefined
	/** The `select` command on a control that is not a native field (offsets in its text). */
	readonly select?: (start: number, end: number) => void
	/** Called once when the host removes it for good: tear down what outlives the DOM. */
	readonly dispose?: () => void
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
	/** A placeholder its lane has not replaced yet: the runner reports it as not implemented. */
	readonly stub?: true
}

export const definePrimitive = (key: TagKey, create: (context: Context) => Primitive): WebPrimitive => ({
	key,
	create,
})

/**
 * What a tag whose renderer its lane has not written draws: a dashed box naming the tag and lane
 * (`data-hz-stub=<lane>`), with a content parent so children still mount. Swift's twin is `NotImplementedView`.
 */
export const stubPrimitive = (key: TagKey): WebPrimitive => ({
	key,
	stub: true,
	create: ({ document, tag, outer }) => {
		const lane = tags[key].web
		const node = outer("div")
		node.dataset.hzStub = lane
		const label = part(document, "span", "stub")
		label.textContent = `${tag}: lane ${lane}`
		const content = part(document, "div", "content")
		node.append(label, content)
		return { tag, outer: node, content, set: () => {}, events: undefined }
	},
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
