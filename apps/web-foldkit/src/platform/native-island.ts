import type { Attribute, Html, HtmlBuilder } from "foldkit/html"

/**
 * Native islands: marks an element a native shell may show or drive with a real platform
 * view (the iOS shell, `apps/ios-hybrid`): a `UITabBar` for the mobile nav, a system menu for a
 * Select, the system's long-press menu for a row (`nativeContextMenu`). The element and its
 * children stay the whole UI everywhere else: the browser ignores these attributes, and a native shell without the component draws the element as it is.
 *
 * Nothing comes back through a channel of its own. The native view replays DOM events on this
 * markup: a tab press is the `click` of the item it stands for, a picker's choice is a `change`
 * on the island's element (`h.OnChange`).
 */

/** The components a native shell may have. */
export type NativeComponent = "tab-bar" | "menu" | "date-picker" | "context-menu"

/** The island's element: its component, and what the component cannot read from the children. */
export const nativeIsland = <Message>(
	h: HtmlBuilder<Message>,
	component: NativeComponent,
	props?: Readonly<Record<string, unknown>>,
): ReadonlyArray<Attribute<Message>> => [
	h.Attribute("data-native", component),
	...(props === undefined ? [] : [h.Attribute("data-native-props", JSON.stringify(props))]),
]

/**
 * A child the native view shows as one of its own items (a tab): its text is the title, its
 * `click` (or link) is what a press on the native item does. `symbol` is an SF Symbol name.
 */
export const nativeItem = <Message>(
	h: HtmlBuilder<Message>,
	item: Readonly<{ id: string; symbol?: string; isSelected?: boolean; badge?: number | undefined }>,
): ReadonlyArray<Attribute<Message>> => [
	h.Attribute("data-native-item", item.id),
	...(item.symbol === undefined ? [] : [h.Attribute("data-native-symbol", item.symbol)]),
	...(item.isSelected ? [h.Attribute("data-native-selected", "true")] : []),
	// A count on the item (unread activity); none for none.
	...(item.badge === undefined ? [] : [h.Attribute("data-native-badge", String(item.badge))]),
]

/**
 * An item of a `menu` island's `props.items`, as the system menu shows it: plain words and state,
 * no markup. `{ separator }` divides groups; an item with `items` is a submenu.
 */
export type NativeMenuItem =
	| Readonly<{
			key: string
			label: string
			/** Absent (JSON drops `undefined`) for an ordinary, enabled, unchecked item. */
			disabled?: true | undefined
			destructive?: true | undefined
			checked?: true | undefined
			/** An SF Symbol name: what the shell shows when the item has no `icon`. */
			symbol?: string | undefined
			/** The icon the web's item draws, as SVG markup (`iconOf`): the native item shows it too. */
			icon?: string | undefined
	  }>
	| Readonly<{ label: string; items: ReadonlyArray<NativeMenuItem> }>
	| Readonly<{ separator: true }>

/**
 * How a `menu` island shows: a pull-down from its trigger (the default, for a few actions on one
 * thing), or a sheet from the bottom edge with a title (an app-level picker: the account, servers).
 */
export type NativeMenuLook = Readonly<{
	presentation?: "sheet"
	title?: string
	subtitle?: string
	/** Items' SF Symbols, by key. Data, not a function: Foldkit keeps view inputs' functions top-level. */
	symbols?: Readonly<Record<string, string>>
	/** Items that read as destructive (red) natively, beyond their `intent`. */
	destructive?: ReadonlyArray<string>
}>

/**
 * A `context-menu` island: a long press on the element opens the system's menu for it (iOS's
 * `UIContextMenuInteraction`), lifting the element as drawn. `quick` is a row of small choices
 * above the items (a message's reactions), each chosen as `prefix + choice`.
 */
export type NativeContextMenu = Readonly<{
	items: ReadonlyArray<NativeMenuItem>
	quick?: Readonly<{ choices: ReadonlyArray<string>; prefix: string }>
}>

/** The element's long-press menu; a choice is `onChoose` with the item's key. */
export const nativeContextMenu = <Message>(
	h: HtmlBuilder<Message>,
	menu: NativeContextMenu,
	onChoose: (key: string) => Message,
): ReadonlyArray<Attribute<Message>> => [...nativeIsland(h, "context-menu", menu), h.OnChange(onChoose)]

/** Escaped for an attribute's double quotes or for text. */
const escapeMarkup = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

type MarkupNode = Readonly<{
	sel?: string
	text?: string
	data?: Readonly<{ attrs?: Readonly<Record<string, string | number | boolean>> }>
	children?: ReadonlyArray<MarkupNode | string>
}>

const isNode = (value: unknown): value is MarkupNode => typeof value === "object" && value !== null

/** An SVG node as markup: its tag, attributes and children (classes and handlers dropped). */
const svgMarkup = (node: MarkupNode | string): string => {
	if (typeof node === "string") return escapeMarkup(node)
	const tag = node.sel?.split(/[.#]/)[0]
	if (tag === undefined || tag === "") return escapeMarkup(node.text ?? "")
	const attributes = Object.entries(node.data?.attrs ?? {})
		.filter(([, value]) => value !== false)
		.map(([name, value]) => ` ${name}="${escapeMarkup(String(value))}"`)
		.join("")
	const children = (node.children ?? []).map(svgMarkup).join("") + escapeMarkup(node.text ?? "")
	return `<${tag}${attributes}>${children}</${tag}>`
}

/**
 * The first icon among an item's children (`ViewInputs.content`), as SVG markup: the native menu
 * shows the icon the web's item draws, from the same view.
 */
export const iconOf = (children: ReadonlyArray<Html | string>): string | undefined => {
	const find = (nodes: ReadonlyArray<unknown>): MarkupNode | undefined => {
		for (const node of nodes) {
			if (!isNode(node)) continue
			if (node.sel?.startsWith("svg") === true) return node
			const found = find(node.children ?? [])
			if (found !== undefined) return found
		}
		return undefined
	}
	const svg = find(children)
	return svg === undefined ? undefined : svgMarkup(svg)
}
