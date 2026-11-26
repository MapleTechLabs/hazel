/**
 * Writes the web's own icons (`web-foldkit/src/icons`) as an asset catalog for the Effect UI spike:
 * each icon's element tree, built with a stub `h`, serialised to SVG and kept as a template image so
 * SwiftUI tints it with the theme's colour. `currentColor` becomes black; its opacities stay.
 *   bun scripts/export-icons.ts build/icons/Icons.xcassets
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as Icons from "../../web-foldkit/src/icons"

/** The asset name a semantic `symbol` maps to (`EffectUiSpike/Theme.swift`), and its web icon. */
const EXPORTS = {
	"hazel.hashtag": Icons.IconHashtag,
	"hazel.lock": Icons.IconLock,
	"hazel.plus": Icons.IconPlus,
	"hazel.chevron-down": Icons.IconChevronDown,
} as const

type Node = {
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
			) => ({
				tag: key,
				attrs,
				children,
			})
		},
	},
)

/** The stub's output, checked: an element node with a tag, attributes and children. */
const asNode = (value: unknown): Node => {
	if (
		typeof value === "object" &&
		value !== null &&
		"tag" in value &&
		typeof value.tag === "string" &&
		"attrs" in value &&
		Array.isArray(value.attrs) &&
		"children" in value &&
		Array.isArray(value.children)
	)
		return { tag: value.tag, attrs: value.attrs, children: value.children }
	throw new Error("an icon did not build an element")
}

const escape = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")

const svg = (node: Node | string): string => {
	if (typeof node === "string") return escape(node)
	if (node.tag === "title") return ""
	const attrs = node.attrs
		.filter(([name]) => name !== "class" && name !== "aria-hidden" && name !== "data-slot")
		.map(([name, value]) => ` ${name}="${escape(value.replaceAll("currentColor", "#000"))}"`)
		.join("")
	return `<${node.tag}${attrs}>${node.children.map(svg).join("")}</${node.tag}>`
}

const out = process.argv[2] ?? "build/icons/Icons.xcassets"
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
writeFileSync(join(out, "Contents.json"), JSON.stringify({ info: { author: "xcode", version: 1 } }))
for (const [name, make] of Object.entries(EXPORTS)) {
	const set = join(out, `${name}.imageset`)
	mkdirSync(set, { recursive: true })
	// The stub stands in for Foldkit's builder: the icon only calls its element and attribute functions.
	// SAFETY: `stub` implements every builder call an icon makes (element functions and Attribute).
	const tree: unknown = make(stub as never)
	writeFileSync(join(set, "icon.svg"), svg(asNode(tree)))
	writeFileSync(
		join(set, "Contents.json"),
		JSON.stringify({
			images: [{ filename: "icon.svg", idiom: "universal" }],
			info: { author: "xcode", version: 1 },
			properties: { "preserves-vector-representation": true, "template-rendering-intent": "template" },
		}),
	)
}
console.log(`${Object.keys(EXPORTS).length} icons -> ${out}`)
