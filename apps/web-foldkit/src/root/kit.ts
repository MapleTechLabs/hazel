// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Static kit visuals (icons, the loader, empty states, count badges) drawn by today's Foldkit kit,
 * turned into Effect UI elements with the same markup. Part of the adapter: it goes with Foldkit.
 */
import type { Html } from "@effect/ui/html"
import type { Html as Foldkit } from "foldkit/html"
import { type HtmlBuilder, inertHtml } from "foldkit/html"

interface KitNode {
	readonly sel?: string
	readonly text?: string
	readonly data?: {
		readonly class?: Readonly<Record<string, boolean>>
		readonly props?: Readonly<Record<string, unknown>>
		readonly attrs?: Readonly<Record<string, unknown>>
		readonly style?: Readonly<Record<string, string>>
	}
	readonly children?: ReadonlyArray<KitNode>
}

/** The Foldkit builder for kit calls whose output only `fromKit` reads (no handlers, no runtime). */
export const kit = inertHtml as unknown as HtmlBuilder<any>

/** Props that are attributes when written as markup. */
const ATTRIBUTE_PROPS = new Set(["id", "href", "src", "alt", "type", "title", "tabIndex"])

const attrsOf = (node: KitNode): Record<string, string> => {
	const data = node.data ?? {}
	const attrs: Record<string, string> = {}
	for (const [name, value] of Object.entries(data.attrs ?? {}))
		if (value !== false && value !== undefined && value !== null)
			attrs[name] = value === true ? "" : String(value)
	for (const [name, value] of Object.entries(data.props ?? {}))
		if (ATTRIBUTE_PROPS.has(name) && value !== undefined && value !== null)
			attrs[name === "tabIndex" ? "tabindex" : name] = String(value)
	const classes = Object.entries(data.class ?? {})
		.filter(([, on]) => on)
		.map(([name]) => name)
	if (classes.length > 0) attrs.class = classes.join(" ")
	const style = Object.entries(data.style ?? {})
		.map(([name, value]) => `${name}:${value}`)
		.join(";")
	if (style !== "") attrs.style = style
	return attrs
}

type Builder<M> = Html.H<M>

/** A converted kit element: a plain container, so it adds no requirements to the view. */
export type KitElement<M> = ReturnType<Html.H<M>["el"]>

/**
 * One kit node as an Effect UI element, children included; text nodes become strings. `press` is
 * what each of its buttons sends when clicked (the kit's own handlers do not cross).
 */
export const fromKit = <M>(h: Builder<M>, html: Foldkit | string, options: { readonly press?: M } = {}): KitElement<M> => {
	if (typeof html === "string") return html as never
	if (html === null) return null as never
	const node = html as unknown as KitNode
	if (node.sel === undefined) return (node.text ?? "") as never
	const tag = node.sel.split(/[.#]/)[0] ?? "div"
	const children: Array<KitElement<M> | string> = (node.children ?? []).map((child) =>
		fromKit(h, child as unknown as Foldkit, options),
	)
	if (node.text !== undefined) children.push(node.text)
	const base = h.el(tag).attrs(attrsOf(node))
	const element = tag === "button" && options.press !== undefined ? base.on("click" as never, options.press as never) : base
	return (children.length === 0 ? element : element.children(...children)) as KitElement<M>
}
