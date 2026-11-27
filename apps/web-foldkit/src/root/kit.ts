// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Static kit visuals (icons, the loader, empty states, count badges) drawn by today's Foldkit kit,
 * turned into Effect UI elements with the same markup. Part of the adapter: it goes with Foldkit.
 */
import type { Html } from "@effect/ui/html"
import { type Html as Foldkit, type HtmlBuilder, inertHtml } from "foldkit/html"

interface KitNode {
	readonly sel?: string
	readonly text?: string
	readonly data?: {
		readonly class?: Readonly<Record<string, boolean>>
		readonly props?: Readonly<Record<string, unknown>>
		readonly attrs?: Readonly<Record<string, unknown>>
		readonly style?: Readonly<Record<string, string>>
	}
	readonly children?: ReadonlyArray<unknown>
}

const isKitNode = (value: unknown): value is KitNode => typeof value === "object" && value !== null

/** Typed as any Message: `fromKit` drops handlers, so a kit call's Message never dispatches. */
const anyMessage = (builder: HtmlBuilder<never>): HtmlBuilder<string> =>
	// SAFETY: the builder only makes VNodes here; the Message type only types handlers fromKit drops.
	builder as unknown as HtmlBuilder<string>

/** The Foldkit builder for kit calls whose output only `fromKit` reads (no handlers, no runtime). */
export const kit = anyMessage(inertHtml)

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

/** A converted kit element: a plain container, so it adds no requirements to the view. */
export type KitElement<M> = ReturnType<Html.H<M>["el"]>

const convert = <M>(h: Html.H<M>, node: unknown, press: M | undefined): KitElement<M> | string | null => {
	if (typeof node === "string") return node
	if (!isKitNode(node)) return null
	if (node.sel === undefined) return node.text ?? ""
	const tag = node.sel.split(/[.#]/)[0] ?? "div"
	const children: Array<KitElement<M> | string> = []
	for (const child of node.children ?? []) {
		const converted = convert(h, child, press)
		if (converted !== null) children.push(converted)
	}
	if (node.text !== undefined) children.push(node.text)
	const base = h.el(tag).attrs(attrsOf(node))
	const element = tag === "button" && press !== undefined ? base.on("click", press) : base
	return children.length === 0 ? element : element.children(...children)
}

/**
 * One kit view as an Effect UI element, children included. `press` is what each of its buttons
 * sends when clicked (the kit's own handlers do not cross).
 */
export const fromKit = <M>(
	h: Html.H<M>,
	html: Foldkit,
	options: { readonly press?: M } = {},
): KitElement<M> => {
	const converted = convert(h, html, options.press)
	return converted === null || typeof converted === "string"
		? h.el("span").children(converted ?? "")
		: converted
}
