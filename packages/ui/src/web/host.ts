// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The web host (G1): wraps `BrowserHost`'s host so `hz:*` tags get the DOM their primitive builds
 * (`primitives.ts`) while every other tag, and `Html.Host` with the document services, pass through.
 */
import { Renderer, type View } from "@effect/ui"
import { BrowserHost, HtmlScheduler } from "@effect/ui/html"
import { Context, Effect, Layer, Scheduler } from "effect"
import { Hazel } from "../vocabulary/index.ts"
import type { Plain } from "./primitives/define.ts"
import { measureNode } from "./focus/measure.ts"
import { afterRemoved } from "./motion.ts"
import { scrollTo } from "./primitives/list/scroll.ts"
import { create, type Primitive, primitiveOf, release } from "./primitives.ts"

type Handlers = Readonly<Record<string, View.Handler<unknown, any>>>

/** Semantic events to the DOM events that raise them. Extension events come through `send`. */
const domEvent = new Map([["press", "click"]])

/** The link a primitive draws as its own box (`item`'s control, `link`), if it draws one now. */
const ownLink = (primitive: Primitive) =>
	primitive.outer.matches("a[href]") ? primitive.outer : primitive.outer.querySelector(":scope > a[href]")

const isPlain = (payload: unknown) => {
	// SAFETY: a `click` payload from BrowserHost (`button` and the four modifiers, `html/internal/payload.ts`).
	const click = payload as {
		button?: number
		meta?: boolean
		ctrl?: boolean
		shift?: boolean
		alt?: boolean
	}
	return (click.button ?? 0) === 0 && !click.meta && !click.ctrl && !click.shift && !click.alt
}

/**
 * A press on a link the view handles is the view's (G2): a plain click raises `press` and cancels the
 * browser's navigation, read before the press's flush can swap the link for a button; a modified click
 * (new tab, download) raises nothing and is left to the browser.
 */
const pressDispatch =
	(primitive: Primitive, dispatch: Parameters<Renderer.Host<Node>["setEvents"]>[2]) =>
	(event: string, handler: View.Handler<unknown, any>, payload: unknown, cancel?: () => void) => {
		if (event !== "click") return dispatch(event, handler, payload)
		// `press` carries no payload (`spec.ts`), never the DOM click's.
		if (ownLink(primitive) === null) return dispatch(event, handler, {})
		if (!isPlain(payload)) return false
		return dispatch(event, handler, {}, cancel)
	}

export const wrapHost = (inner: Renderer.Host<Node>, document: Document): Renderer.Host<Node> => {
	const primitives = new WeakMap<Node, Primitive>()
	// A primitive's content parent, back to its outer node: what `parentOf` reports.
	const owners = new WeakMap<Node, Node>()
	const contentOf = (node: Node) => primitives.get(node)?.content ?? node

	return {
		...inner,
		createElement: (tag) => {
			const primitive = tag.startsWith("hz:") ? create(document, tag) : undefined
			if (primitive === undefined) return inner.createElement(tag)
			primitives.set(primitive.outer, primitive)
			if (primitive.content !== primitive.outer) owners.set(primitive.content, primitive.outer)
			return primitive.outer
		},
		setAttr: (node, name, value, previous) => {
			if (!primitives.has(node)) inner.setAttr(node, name, value, previous)
		},
		normalizeAttrs: (node, attrs) =>
			primitives.has(node) || inner.normalizeAttrs === undefined
				? attrs
				: inner.normalizeAttrs(node, attrs),
		setProp: (node, name, value) => {
			const primitive = primitives.get(node)
			if (primitive === undefined) inner.setProp(node, name, value)
			// `row-key`: every keyed element's key, for rows, anchors and `scrollTo({key})`.
			else if (name === Hazel.KEY_PROP) {
				if (!(node instanceof Element)) return
				if (typeof value === "string") node.setAttribute("data-hz-key", value)
				else node.removeAttribute("data-hz-key")
			}
			// SAFETY: `hz:*` props are plain data: `spec.ts` types every prop with a JSON schema.
			else primitive.set(name, value as Plain)
		},
		insertBefore: (parent, node, ref) => inner.insertBefore(contentOf(parent), node, ref),
		remove: (node) => {
			release(node)
			inner.remove(node)
			afterRemoved(node)
		},
		parentOf: (node) => {
			const parent = inner.parentOf(node)
			return parent === undefined ? undefined : (owners.get(parent) ?? parent)
		},
		setEvents: (node, handlers: Handlers, dispatch, options) => {
			const primitive = primitives.get(node)
			if (primitive === undefined) return inner.setEvents(node, handlers, dispatch, options)
			primitive.events = { handlers, dispatch }
			const mapped: Record<string, View.Handler<unknown, any>> = {}
			for (const [name, handler] of Object.entries(handlers)) {
				const dom = domEvent.get(name)
				if (dom !== undefined) mapped[dom] = handler
			}
			const press: Record<string, View.EventOptions> =
				mapped.click === undefined ? {} : { click: { preventDefault: true } }
			inner.setEvents(node, mapped, pressDispatch(primitive, dispatch), press)
		},
		elements: [Hazel.name, ...(inner.elements === "any" ? [] : inner.elements)],
	}
}

/** The element a command acts on: a control's `data-hz-focus` part (its input), else the node. */
const target = (node: Hazel.HostNode): HTMLElement => {
	const element = node as HTMLElement
	return element.querySelector<HTMLElement>("[data-hz-focus]") ?? element
}
const commands: Hazel.Host["Service"] = {
	focus: (node) => Effect.sync(() => target(node).focus()),
	blur: (node) => Effect.sync(() => target(node).blur()),
	scrollTo: (node, to) => Effect.sync(() => scrollTo(node, to)),
	measure: (node) => Effect.sync(() => measureNode(node as Node)),
	// A2: focuses the field and selects `start..end` (clamped by the browser); a primitive that is
	// not a native field (the composer's editor) maps the offsets itself.
	select: (node, range) =>
		Effect.sync(() => {
			const own = primitiveOf(node as Node)?.select
			if (own !== undefined) return own(range.start, range.end)
			const field = target(node)
			if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return
			field.focus()
			field.setSelectionRange(range.start, range.end)
		}),
}

/**
 * `BrowserHost.layer()` with its `Renderer` wrapped, plus `Hazel.Host` and the scheduler
 * `BrowserHost.mount` would have given (a `hazel` root mounts with `Renderer.mount`).
 */
export const layer = (options?: {
	readonly document?: Document | undefined
}): Layer.Layer<Renderer.Renderer | Hazel.Host | Layer.Success<ReturnType<typeof BrowserHost.layer>>> =>
	Layer.effectContext(
		Effect.gen(function* () {
			const document = options?.document ?? globalThis.document
			const context = yield* Layer.build(BrowserHost.layer({ document }))
			const inner = Context.get(context, Renderer.Renderer).host as Renderer.Host<Node>
			return context.pipe(
				Context.add(Renderer.Renderer, { host: wrapHost(inner, document) }),
				Context.add(Hazel.Host, commands),
				Context.add(Scheduler.Scheduler, HtmlScheduler.make()),
			)
		}),
	)
