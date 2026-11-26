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
import { NotImplemented } from "../vocabulary/spec.ts"
import { create, type Primitive, release } from "./primitives.ts"

type Handlers = Readonly<Record<string, View.Handler<unknown, any>>>

/** Semantic events to the DOM events that raise them. Extension events come through `send`. */
const domEvent: Readonly<Record<string, string>> = { press: "click" }

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
			primitives.has(node) || inner.normalizeAttrs === undefined ? attrs : inner.normalizeAttrs(node, attrs),
		setProp: (node, name, value) => {
			const primitive = primitives.get(node)
			if (primitive === undefined) inner.setProp(node, name, value)
			else primitive.set(name, value)
		},
		insertBefore: (parent, node, ref) => inner.insertBefore(contentOf(parent), node, ref),
		remove: (node) => {
			release(node)
			inner.remove(node)
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
			for (const name in handlers) {
				const dom = domEvent[name]
				if (dom !== undefined) mapped[dom] = handlers[name]!
			}
			inner.setEvents(node, mapped, dispatch, {})
		},
		elements: [Hazel.name, ...(inner.elements === "any" ? [] : inner.elements)],
	}
}

// C1: focus is real; the rest belong to the lanes that own scrolling (A4) and fields (A2).
const notYet = (name: string, lane: string) => Effect.die(new NotImplemented({ what: `web command ${name}`, lane }))
const commands: Hazel.Host["Service"] = {
	focus: (node) => Effect.sync(() => (node as HTMLElement).focus()),
	blur: (node) => Effect.sync(() => (node as HTMLElement).blur()),
	scrollTo: () => notYet("scrollTo", "A4"),
	measure: () => notYet("measure", "A3"),
	select: () => notYet("select", "A2"),
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
