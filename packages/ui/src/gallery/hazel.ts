import { IconHashtag, IconPlus } from "../../../../apps/web-foldkit/src/icons/index.ts"
import { applyTheme } from "./page.ts"
import {
	type BadgeSpec,
	badges,
	type ButtonSpec,
	buttons,
	type IconName,
	type ItemSpec,
	sections,
} from "./specimens.ts"

/**
 * The hazel side: plain DOM in the structure the web host builds (`src/web/primitives.ts`: `data-hz`,
 * `data-hz-part`, `data-hz-slot`, option and state attributes), styled only by the generated `tokens.css`.
 */

const SVG = "http://www.w3.org/2000/svg"

type Attr = readonly ["attr", string, string]

/** The web's own icon, drawn through a stub of Foldkit's builder (as `export-icons.ts` does). */
const iconBuilder = new Proxy(
	{},
	{
		get: (_, key: string) => {
			if (key === "Attribute") return (name: string, value: string): Attr => ["attr", name, value]
			if (key === "Class") return (value: string): Attr => ["attr", "class", value]
			return (attrs: ReadonlyArray<Attr> = [], children: ReadonlyArray<Element | string> = []) => {
				const element = document.createElementNS(SVG, key)
				for (const [, name, value] of attrs)
					if (name !== "data-slot") element.setAttribute(name, value)
				element.append(...children)
				return element
			}
		},
	},
)

const icon = (name: IconName, attributes: Readonly<Record<string, string>>): Element => {
	const make = name === "hashtag" ? IconHashtag : IconPlus
	// SAFETY: the stub stands in for Foldkit's builder; an icon only calls its element and attribute functions.
	const element: unknown = make(iconBuilder as never)
	if (!(element instanceof Element)) throw new Error(`The ${name} icon did not build an element`)
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value)
	return element
}

const el = (
	tag: string,
	attributes: Readonly<Record<string, string | boolean | undefined>>,
	children: ReadonlyArray<Node | string> = [],
): HTMLElement => {
	const element = document.createElement(tag)
	for (const [key, value] of Object.entries(attributes)) {
		if (value === undefined || value === false) continue
		element.setAttribute(key, value === true ? "" : value)
	}
	element.append(...children)
	return element
}

/** An item: its control (a link, or a button when selected) holds the content parent and the title. */
const item = (spec: ItemSpec) =>
	el(
		"div",
		{
			"data-hz": "item",
			"data-specimen": spec.id,
			"data-selected": spec.selected,
			"data-emphasized": spec.emphasized,
		},
		[
			el(
				spec.selected ? "button" : "a",
				{
					"data-hz-part": "control",
					type: spec.selected ? "button" : undefined,
					href: spec.selected ? undefined : "#",
					"aria-current": spec.selected ? "page" : undefined,
				},
				[
					el("span", { "data-hz-part": "content" }, [
						el("span", { "data-hz": "slot", "data-hz-slot": "leading", "data-name": "leading" }, [
							icon(spec.icon, { "data-hz": "icon", "aria-hidden": "true" }),
						]),
					]),
					el("span", { "data-hz-part": "title" }, [spec.title]),
				],
			),
		],
	)

const button = (spec: ButtonSpec) =>
	el(
		"button",
		{
			type: "button",
			"data-hz": "button",
			"data-specimen": spec.id,
			"data-variant": spec.variant,
			"data-size": spec.size,
			"data-icon-only": spec.iconOnly,
			"data-circle": spec.circle,
			"data-disabled": spec.disabled,
			"data-loading": spec.loading,
			"data-selected": spec.selected,
			"aria-pressed": spec.variant === "chip" ? String(spec.selected ?? false) : undefined,
			disabled: spec.disabled,
		},
		[
			...(spec.icon ? [icon(spec.icon, { "data-hz-part": "icon", "aria-hidden": "true" })] : []),
			...(spec.label ? [el("span", { "data-hz-part": "label" }, [spec.label])] : []),
		],
	)

const badge = (spec: BadgeSpec) =>
	el(
		"span",
		{
			"data-hz": "badge",
			"data-specimen": spec.id,
			"data-tone": spec.tone,
			"data-style": spec.style,
			"data-size": spec.size,
			"data-pill": spec.pill,
		},
		[spec.label],
	)

applyTheme()
const app = document.getElementById("app")
if (app === null) throw new Error("hazel.html has no #app")
app.append(
	el(
		"div",
		{ class: "frames" },
		sections.map((section) =>
			el("div", { class: "frame-sidebar", "data-specimen": section.id }, [
				el("section", { "data-hz": "section", "aria-label": section.title }, [
					el("h2", { "data-hz-part": "title" }, [section.title]),
					el("div", { "data-hz-part": "content" }, section.items.map(item)),
				]),
			]),
		),
	),
	el(
		"div",
		{ class: "frames frame-buttons" },
		buttons.map((spec) => el("div", { class: "frame-button" }, [button(spec)])),
	),
	el(
		"div",
		{ class: "frames frame-buttons" },
		badges.map((spec) => el("div", { class: "frame-button" }, [badge(spec)])),
	),
)
document.documentElement.dataset.ready = "true"
