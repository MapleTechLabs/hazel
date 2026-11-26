/**
 * The web's own icons (`apps/web-foldkit/src/icons`), one per `IconName` (`iconSources`), as SVG
 * markup. Each icon is built once with a stub of Foldkit's `h` (it only calls element and attribute
 * functions), the same way `apps/ios-hybrid/scripts/export-icons.ts` exports them for iOS.
 */
import * as Icons from "../../../../apps/web-foldkit/src/icons/index.ts"
import { iconNames, iconSources, type IconName } from "../vocabulary/options.ts"

interface Node {
	readonly tag: string
	readonly attrs: ReadonlyArray<readonly [string, string]>
	readonly children: ReadonlyArray<Node | string>
}

const attribute = (name: string, value: string) => [name, value] as const
const stub = new Proxy(
	{},
	{
		get: (_, key: string) => {
			if (key === "Attribute") return attribute
			if (key === "Class") return (value: string) => attribute("class", value)
			return (
				attrs: ReadonlyArray<readonly [string, string]> = [],
				children: ReadonlyArray<Node | string> = [],
			): Node => ({ tag: key, attrs, children })
		},
	},
)

const escape = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")

// Sizing comes from the recipe (`[data-hz=icon] > svg` fills its box), so the fixed size is dropped.
const dropped = new Set(["class", "data-slot", "width", "height"])

const markup = (node: Node | string): string => {
	if (typeof node === "string") return escape(node)
	if (node.tag === "title") return ""
	const attrs = node.attrs
		.filter(([name]) => !dropped.has(name))
		.map(([name, value]) => ` ${name}="${escape(value)}"`)
		.join("")
	return `<${node.tag}${attrs}>${node.children.map(markup).join("")}</${node.tag}>`
}

const build = (name: IconName) => {
	// SAFETY: the stub stands in for Foldkit's `HtmlBuilder`; an icon only calls `h.<tag>` and
	// `h.Attribute`, so what it returns is the stub's `Node` tree.
	const make = Icons[iconSources[name]] as unknown as (h: typeof stub) => Node
	return markup(make(stub))
}

const icons: ReadonlyMap<string, string> = new Map(iconNames.map((name) => [name, build(name)]))

/** An icon's SVG; an unknown name draws an empty 18pt box, so a bad name never throws in a view. */
export const svg = (name: string) => icons.get(name) ?? '<svg viewBox="0 0 18 18" aria-hidden="true"></svg>'

/** Draws icon `name` filling `container` (a part with its own recipe size); undefined clears it. */
export const glyph = (container: HTMLElement, name: string | undefined) => {
	container.innerHTML = name === undefined ? "" : svg(name)
	const drawn = container.firstElementChild
	if (!(drawn instanceof SVGElement)) return
	drawn.style.display = "block"
	drawn.style.width = "100%"
	drawn.style.height = "100%"
}
