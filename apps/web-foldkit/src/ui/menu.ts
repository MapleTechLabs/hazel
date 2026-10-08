import { Array, Duration, Effect, Match, Option, Schema } from "effect"
import { Command, type Update } from "foldkit"
import * as Dom from "foldkit/dom"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { Placement } from "./aria/placement"

/**
 * Port of `components/ui/menu.tsx` (React Aria MenuTrigger, Menu, SubmenuTrigger). The Model holds
 * the menu's structure and interaction state; item content comes from the view's `content` callback.
 * The view lives in `menu-view.ts`.
 */

// MODEL

export const Intent = Schema.Literals(["Danger", "Warning"])
export type Intent = typeof Intent.Type

export const Leaf = Schema.Struct({
	key: Schema.String,
	textValue: Schema.Option(Schema.String),
	isDisabled: Schema.Boolean,
	intent: Schema.Option(Intent),
	hasDescription: Schema.Boolean,
	/** `MenuItemLink` / `MenuItem href`: renders an `<a>`, which the app's link handling follows. */
	href: Schema.Option(Schema.String),
})
export type Leaf = typeof Leaf.Type

export const Item = Schema.Struct({ ...Leaf.fields, submenu: Schema.Array(Leaf) })
export type Item = typeof Item.Type

export const Entry = Schema.Union([
	Schema.TaggedStruct("Item", { item: Item }),
	Schema.TaggedStruct("Section", {
		label: Schema.Option(Schema.String),
		/** `MenuHeader` as the section's first child; its content is `content(key)`. */
		header: Schema.Option(Schema.Struct({ key: Schema.String, hasSeparator: Schema.Boolean })),
		items: Schema.Array(Item),
	}),
	Schema.TaggedStruct("Separator", {}),
])
export type Entry = typeof Entry.Type

export const SelectionMode = Schema.Literals(["None", "Single"])
export const Modality = Schema.Literals(["Keyboard", "Pointer"])
export type Modality = typeof Modality.Type

const Submenu = Schema.Struct({ triggerKey: Schema.String, focusedKey: Schema.Option(Schema.String) })

export const Popup = Schema.Union([
	Schema.TaggedStruct("Closed", {}),
	Schema.TaggedStruct("Open", {
		focusedKey: Schema.Option(Schema.String),
		hoveredKey: Schema.Option(Schema.String),
		modality: Modality,
		submenu: Schema.Option(Submenu),
		search: Schema.String,
		/** Set when a ContextMenu opened at the pointer (Popover `offset` / `crossOffset`). */
		pointerOffset: Schema.Option(Schema.Struct({ offset: Schema.Number, crossOffset: Schema.Number })),
	}),
])
type Open = Extract<typeof Popup.Type, { _tag: "Open" }>

export const Model = Schema.Struct({
	id: Schema.String,
	entries: Schema.Array(Entry),
	selectionMode: SelectionMode,
	selectedKeys: Schema.Array(Schema.String),
	placement: Placement,
	anchor: Schema.Literals(["Trigger", "Pointer"]),
	popup: Popup,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	PressedTrigger: { pointerType: Schema.String },
	PressedTriggerKey: { key: Schema.String },
	PressedContextMenu: { offset: Schema.Number, crossOffset: Schema.Number },
	PressedMenuKey: { key: Schema.String, isModified: Schema.Boolean },
	HoveredItem: { key: Schema.String },
	UnhoveredItem: { key: Schema.String },
	ClickedItem: { key: Schema.String },
	PressedOutside: {},
	ClickedDismiss: {},
	CompletedFocusElement: {},
	CompletedWaitForTypeaheadReset: { search: Schema.String },
	CompletedPositionMenu: {},
	CompletedPortalMenu: {},
	CompletedCaptureContextMenu: {},
	CompletedFocusTriggerOnPress: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
	SelectedItem: { key: Schema.String },
	/** A link item activated from the keyboard; a click is followed by the `<a>` itself. */
	ActivatedLink: { key: Schema.String, href: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

// INIT

export const leaf = (
	key: string,
	options: Partial<
		Readonly<{
			textValue: string
			isDisabled: boolean
			intent: Intent
			hasDescription: boolean
			href: string
		}>
	> = {},
): Leaf => ({
	key,
	textValue: Option.fromNullishOr(options.textValue),
	isDisabled: options.isDisabled ?? false,
	intent: Option.fromNullishOr(options.intent),
	hasDescription: options.hasDescription ?? false,
	href: Option.fromNullishOr(options.href),
})

export const item = (
	key: string,
	options: Parameters<typeof leaf>[1] & Readonly<{ submenu?: ReadonlyArray<Leaf> }> = {},
): Entry => ({ _tag: "Item", item: { ...leaf(key, options), submenu: options.submenu ?? [] } })

export const section = (
	label: string | undefined,
	items: ReadonlyArray<Entry>,
	options: Readonly<{ header?: Readonly<{ key: string; hasSeparator?: boolean }> }> = {},
): Entry => ({
	_tag: "Section",
	label: Option.fromNullishOr(label),
	header: Option.map(Option.fromNullishOr(options.header), (header) => ({
		key: header.key,
		hasSeparator: header.hasSeparator ?? false,
	})),
	items: Array.flatMap(items, (entry) => (entry._tag === "Item" ? [entry.item] : [])),
})

export const separator: Entry = { _tag: "Separator" }

export const init = (config: {
	readonly id: string
	readonly entries: ReadonlyArray<Entry>
	readonly selectionMode?: "None" | "Single"
	readonly selectedKeys?: ReadonlyArray<string>
	/** MenuContent `placement`; MenuTrigger's own default is `bottom start`. */
	readonly placement?: Placement
	/** `Pointer` for a ContextMenu, which opens where the trigger is right-clicked. */
	readonly anchor?: "Trigger" | "Pointer"
}): Model => ({
	id: config.id,
	entries: config.entries,
	selectionMode: config.selectionMode ?? "None",
	selectedKeys: config.selectedKeys ?? [],
	placement: config.placement ?? "bottom start",
	anchor: config.anchor ?? "Trigger",
	popup: { _tag: "Closed" },
})

/** The parent owns the menu's structure (it follows data), so it reflects it in; state is kept. */
export const reflectEntries = (model: Model, entries: ReadonlyArray<Entry>): Model =>
	modifyFields(model, { entries: () => entries })

// IDS

export const triggerId = (id: string) => `${id}-trigger`
export const menuId = (id: string) => `${id}-menu`
export const submenuId = (id: string) => `${id}-submenu`
export const popoverId = (id: string) => `${id}-popover`
export const itemId = (id: string, key: string) => `${id}-item-${key}`
export const labelId = (id: string, key: string) => `${id}-label-${key}`
export const descriptionId = (id: string, key: string) => `${id}-description-${key}`
export const headerId = (id: string, key: string) => `${id}-header-${key}`

// COLLECTION

export const rootItems = (model: Model): ReadonlyArray<Item> =>
	Array.flatMap(model.entries, (entry) =>
		Match.value(entry).pipe(
			Match.tagsExhaustive({
				Item: ({ item }) => [item],
				Section: ({ items }) => items,
				Separator: () => [],
			}),
		),
	)

const findItem = (model: Model, key: string): Option.Option<Item> =>
	Array.findFirst(rootItems(model), (candidate) => candidate.key === key)

const submenuItems = (model: Model, triggerKey: string): ReadonlyArray<Leaf> =>
	Option.match(findItem(model, triggerKey), { onNone: () => [], onSome: (found) => found.submenu })

const enabledKeys = (items: ReadonlyArray<Leaf>): ReadonlyArray<string> =>
	Array.map(
		Array.filter(items, (candidate) => !candidate.isDisabled),
		(candidate) => candidate.key,
	)

/** ListKeyboardDelegate: the next enabled key, wrapping like React Aria menus (`shouldFocusWrap`). */
const stepKey = (
	items: ReadonlyArray<Leaf>,
	from: Option.Option<string>,
	direction: 1 | -1,
): Option.Option<string> => {
	const keys = enabledKeys(items)
	const first = direction === 1 ? Array.head(keys) : Array.last(keys)
	return Option.match(
		Option.flatMap(from, (key) => Array.findFirstIndex(keys, (candidate) => candidate === key)),
		{
			onNone: () => first,
			onSome: (index) => Option.orElse(Array.get(keys, index + direction), () => first),
		},
	)
}

/** useTypeSelect: match from the focused key on, then from the top (case-insensitive prefix). */
const searchKey = (
	items: ReadonlyArray<Leaf>,
	search: string,
	from: Option.Option<string>,
): Option.Option<string> => {
	const matches = (candidate: Leaf) =>
		!candidate.isDisabled &&
		Option.exists(
			candidate.textValue,
			(text) => text.slice(0, search.length).toLowerCase() === search.toLowerCase(),
		)
	const start = Option.getOrElse(
		Option.flatMap(from, (key) => Array.findFirstIndex(items, (candidate) => candidate.key === key)),
		() => 0,
	)
	return Option.map(
		Option.orElse(Array.findFirst(Array.drop(items, start), matches), () =>
			Array.findFirst(items, matches),
		),
		(found) => found.key,
	)
}

// COMMAND

export const FocusElement = Command.define("FocusMenuElement", {
	args: { elementId: Schema.String },
	messages: [Message.CompletedFocusElement],
	execute: ({ elementId }) =>
		Dom.focus(`#${CSS.escape(elementId)}`, { preventScroll: true }).pipe(
			Effect.ignore,
			Effect.as(Message.CompletedFocusElement()),
		),
})

const TYPEAHEAD_RESET = Duration.millis(1000)

export const WaitForTypeaheadReset = Command.define("WaitForMenuTypeaheadReset", {
	args: { search: Schema.String },
	messages: [Message.CompletedWaitForTypeaheadReset],
	execute: ({ search }) =>
		Effect.sleep(TYPEAHEAD_RESET).pipe(Effect.as(Message.CompletedWaitForTypeaheadReset({ search }))),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const focusFor = (model: Model, open: Open): Command.Command<Message> =>
	Option.match(
		Option.flatMap(open.submenu, (submenu) => submenu.focusedKey),
		{
			onSome: (key) => FocusElement({ elementId: itemId(model.id, key) }),
			onNone: () =>
				FocusElement({
					elementId: Option.match(open.focusedKey, {
						onNone: () => menuId(model.id),
						onSome: (key) => itemId(model.id, key),
					}),
				}),
		},
	)

const withOpen = (model: Model, open: Open, isFocusMoved: boolean): UpdateReturn => {
	const nextModel = modifyFields(model, { popup: () => open })
	return isFocusMoved ? { model: nextModel, commands: [focusFor(nextModel, open)] } : { model: nextModel }
}

const opened = (model: Model, strategy: "None" | "First" | "Last", modality: Modality): UpdateReturn => {
	const items = rootItems(model)
	const strategyKey =
		strategy === "None"
			? Option.none<string>()
			: stepKey(items, Option.none(), strategy === "First" ? 1 : -1)
	const focusedKey = Option.orElse(Array.head(model.selectedKeys), () => strategyKey)
	// NOTE: the portal Mount moves initial focus, since the trigger's tree is inert until it runs.
	return withOpen(
		model,
		{
			_tag: "Open",
			focusedKey,
			hoveredKey: Option.none(),
			modality,
			submenu: Option.none(),
			search: "",
			pointerOffset: Option.none(),
		},
		false,
	)
}

const closed = (model: Model): Model => modifyFields(model, { popup: () => ({ _tag: "Closed" as const }) })

const activated = (model: Model, open: Open, key: string, modality: Modality): UpdateReturn => {
	const isSubmenuTrigger = Option.exists(findItem(model, key), (found) =>
		Array.isReadonlyArrayNonEmpty(found.submenu),
	)
	if (isSubmenuTrigger) {
		const first = stepKey(submenuItems(model, key), Option.none(), 1)
		return withOpen(
			model,
			{
				...open,
				modality,
				focusedKey: Option.some(key),
				submenu: Option.some({
					triggerKey: key,
					focusedKey: modality === "Keyboard" ? first : Option.none(),
				}),
			},
			modality === "Keyboard",
		)
	}
	const selectedKeys = model.selectionMode === "Single" ? [key] : model.selectedKeys
	const href = Option.flatMap(findItem(model, key), (found) => found.href)
	return {
		model: modifyFields(closed(model), { selectedKeys: () => selectedKeys }),
		outMessage:
			Option.isSome(href) && modality === "Keyboard"
				? OutMessage.ActivatedLink({ key, href: href.value })
				: OutMessage.SelectedItem({ key }),
	}
}

const pressedMenuKey = (model: Model, open: Open, key: string, isModified: boolean): UpdateReturn => {
	const keyboard: Open = { ...open, modality: "Keyboard" }
	const inSubmenu = Option.filter(open.submenu, (submenu) => Option.isSome(submenu.focusedKey))
	const items: ReadonlyArray<Leaf> = Option.match(inSubmenu, {
		onNone: () => rootItems(model),
		onSome: (submenu) => submenuItems(model, submenu.triggerKey),
	})
	const current = Option.match(inSubmenu, {
		onNone: () => open.focusedKey,
		onSome: (submenu) => submenu.focusedKey,
	})
	const focused = (nextKey: Option.Option<string>): UpdateReturn =>
		Option.match(inSubmenu, {
			onNone: () => withOpen(model, { ...keyboard, focusedKey: nextKey, submenu: Option.none() }, true),
			onSome: (submenu) =>
				withOpen(
					model,
					{ ...keyboard, submenu: Option.some({ ...submenu, focusedKey: nextKey }) },
					true,
				),
		})

	return Match.value(key).pipe(
		Match.when("ArrowDown", () => focused(stepKey(items, current, 1))),
		Match.when("ArrowUp", () => focused(stepKey(items, current, -1))),
		Match.when("Home", () => focused(stepKey(items, Option.none(), 1))),
		Match.when("End", () => focused(stepKey(items, Option.none(), -1))),
		Match.when("Escape", () =>
			Option.match(inSubmenu, {
				onNone: () => ({ model: closed(model) }),
				onSome: () => withOpen(model, { ...keyboard, submenu: Option.none() }, true),
			}),
		),
		Match.when("ArrowLeft", () =>
			Option.isSome(inSubmenu)
				? withOpen(model, { ...keyboard, submenu: Option.none() }, true)
				: { model },
		),
		// useTypeSelect: Space extends an active typeahead search instead of activating.
		Match.when(
			(pressed) => pressed === "Enter" || (pressed === " " && open.search === ""),
			() =>
				Option.match(current, {
					onNone: () => ({ model }),
					onSome: (focusedKey) => activated(model, keyboard, focusedKey, "Keyboard"),
				}),
		),
		Match.when("ArrowRight", () => {
			const submenuTrigger = Option.filter(
				Option.filter(current, () => Option.isNone(inSubmenu)),
				(focusedKey) =>
					Option.exists(findItem(model, focusedKey), (found) =>
						Array.isReadonlyArrayNonEmpty(found.submenu),
					),
			)
			return Option.match(submenuTrigger, {
				onNone: () => ({ model }),
				onSome: (focusedKey) => activated(model, keyboard, focusedKey, "Keyboard"),
			})
		}),
		Match.orElse(() => {
			if (key.length !== 1 || isModified || (open.search === "" && key === " ")) return { model }
			const search = `${open.search}${key}`
			const next = withOpen(model, { ...keyboard, search }, false)
			const target = searchKey(items, search, current)
			const searched = Option.isSome(target) ? focused(target) : next
			return {
				model: modifyFields(searched.model, {
					popup: (popup) => (popup._tag === "Open" ? { ...popup, search } : popup),
				}),
				commands: [...(searched.commands ?? []), WaitForTypeaheadReset({ search })],
			}
		}),
	)
}

export const update = (model: Model, message: Message): UpdateReturn => {
	const ifOpen = (onOpen: (open: Open) => UpdateReturn): UpdateReturn =>
		model.popup._tag === "Open" ? onOpen(model.popup) : { model }

	return Message.match<UpdateReturn>(message, {
		PressedTrigger: ({ pointerType }) =>
			model.popup._tag === "Closed" && pointerType !== "touch"
				? opened(model, "None", "Pointer")
				: { model },
		PressedTriggerKey: ({ key }) =>
			Match.value(key).pipe(
				Match.whenOr("Enter", " ", "ArrowDown", () => opened(model, "First", "Keyboard")),
				Match.when("ArrowUp", () => opened(model, "Last", "Keyboard")),
				Match.orElse(() => ({ model })),
			),
		PressedContextMenu: ({ offset, crossOffset }) =>
			withOpen(
				model,
				{
					_tag: "Open",
					focusedKey: Option.none(),
					hoveredKey: Option.none(),
					modality: "Pointer",
					submenu: Option.none(),
					search: "",
					pointerOffset: Option.some({ offset, crossOffset }),
				},
				false,
			),
		PressedMenuKey: ({ key, isModified }) =>
			ifOpen((open) => pressedMenuKey(model, open, key, isModified)),
		HoveredItem: ({ key }) =>
			ifOpen((open) => {
				const pointer: Open = { ...open, modality: "Pointer", hoveredKey: Option.some(key) }
				const inSubmenu = Option.exists(open.submenu, (submenu) =>
					Array.some(submenuItems(model, submenu.triggerKey), (candidate) => candidate.key === key),
				)
				if (inSubmenu)
					return withOpen(
						model,
						{
							...pointer,
							submenu: Option.map(open.submenu, (submenu) => ({
								...submenu,
								focusedKey: Option.some(key),
							})),
						},
						true,
					)
				const hovered = findItem(model, key)
				if (Option.exists(hovered, (found) => found.isDisabled))
					return withOpen(model, pointer, false)
				const hasSubmenu = Option.exists(hovered, (found) =>
					Array.isReadonlyArrayNonEmpty(found.submenu),
				)
				const submenu = hasSubmenu
					? Option.some({ triggerKey: key, focusedKey: Option.none<string>() })
					: Option.none()
				return withOpen(model, { ...pointer, focusedKey: Option.some(key), submenu }, true)
			}),
		UnhoveredItem: ({ key }) =>
			ifOpen((open) =>
				withOpen(
					model,
					{ ...open, hoveredKey: Option.filter(open.hoveredKey, (hovered) => hovered !== key) },
					false,
				),
			),
		ClickedItem: ({ key }) =>
			ifOpen((open) => {
				const clicked = Option.orElse(findItem(model, key), () =>
					Option.flatMap(open.submenu, (submenu) =>
						Array.findFirst(
							submenuItems(model, submenu.triggerKey),
							(candidate) => candidate.key === key,
						),
					),
				)
				return Option.exists(clicked, (found) => !found.isDisabled)
					? activated(model, open, key, "Pointer")
					: { model }
			}),
		PressedOutside: () => ({ model: closed(model) }),
		ClickedDismiss: () => ({ model: closed(model) }),
		CompletedFocusElement: () => ({ model }),
		CompletedWaitForTypeaheadReset: ({ search }) =>
			ifOpen((open) =>
				open.search === search ? withOpen(model, { ...open, search: "" }, false) : { model },
			),
		CompletedPositionMenu: () => ({ model }),
		CompletedPortalMenu: () => ({ model }),
		CompletedCaptureContextMenu: () => ({ model }),
		CompletedFocusTriggerOnPress: () => ({ model }),
	})
}
