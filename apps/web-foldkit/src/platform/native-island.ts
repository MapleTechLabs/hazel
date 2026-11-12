import type { Attribute, HtmlBuilder } from "foldkit/html"

/**
 * Native islands: marks an element the Rune-native app may show or drive with a real platform
 * view (`apps/native/host/src/islands.rs`): a `UITabBar` for the mobile nav, a system menu for a
 * Select, the system's long-press menu for a message. The element and its children stay the whole UI everywhere else: the browser ignores
 * these attributes, and a native shell without the component draws the element as it is.
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
			/** An SF Symbol name. */
			symbol?: string | undefined
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
