import { Array, Effect, Option, Queue, Schema, Stream } from "effect"
import { Mount, Submodel } from "foldkit"
import {
	type ChildAttribute,
	childAttributes,
	type Html,
	type HtmlBuilder,
	type KeyboardModifiers,
} from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	dropdownCheckIndicatorClassName,
	dropdownDescriptionBase,
	dropdownItemStyles,
	dropdownKeyboardBase,
	dropdownLabelBase,
	dropdownSectionStyles,
	dropdownSeparatorBase,
} from "~/components/ui/dropdown.styles"
import { keyboardStyles } from "~/components/ui/keyboard.styles"
import {
	menuChevronClassName,
	menuContentStyles,
	menuHeaderBase,
	menuHeaderSeparator,
	menuItemSubmenuOpen,
	menuPopoverBase,
	menuTriggerBase,
} from "~/components/ui/menu.styles"
import { popoverContentBase, popoverInnerClassName } from "~/components/ui/popover.styles"
import { IconCheck, IconChevronRight } from "../icons"
import { dismissButton, focusScopeSentinel, openModalPopover, positionOverlay } from "./aria/overlay"
import type { Placement } from "./aria/position"
import {
	descriptionId,
	type Entry,
	headerId,
	itemId,
	labelId,
	type Leaf,
	Message,
	type Model,
	menuId,
	popoverId,
	rootItems,
	submenuId,
	triggerId,
} from "./menu"

const MENU_OFFSET = 8

// MOUNT

const popoverSelector = (id: string) => `[data-menu-popover="${CSS.escape(id)}"]`

/** Overlay + Popover for the root menu: portal, inert outside, scroll lock, position, focus, dismiss. */
type PortalMenuMessage = Extract<Message, { _tag: "CompletedPortalMenu" | "PressedOutside" }>

const PortalMenu = Mount.defineStream("PortalMenu", {
	args: {
		id: Schema.String,
		placement: Schema.String,
		offset: Schema.Number,
		crossOffset: Schema.Number,
		isTriggerWidthSet: Schema.Boolean,
		initialFocusId: Schema.String,
	},
	messages: [Message.CompletedPortalMenu, Message.PressedOutside],
	execute: ({ element, id, placement, offset, crossOffset, isTriggerWidthSet, initialFocusId }) =>
		Stream.callback<PortalMenuMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const release = openModalPopover(element, {
						triggerId: triggerId(id),
						placement: placement as Placement,
						offset,
						crossOffset,
						isTriggerWidthSet,
						initialFocusId,
						insideSelector: popoverSelector(id),
						onInteractOutside: () => Queue.offerUnsafe(queue, Message.PressedOutside()),
					})
					Queue.offerUnsafe(queue, Message.CompletedPortalMenu())
					return release
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

/** Submenu popovers render inside the root's container, so they are only positioned. */
const PositionSubmenu = Mount.define("PositionSubmenu", {
	args: { triggerId: Schema.String },
	messages: [Message.CompletedPositionMenu],
	execute: ({ element, triggerId }) =>
		Effect.acquireRelease(
			Effect.sync(() =>
				element instanceof HTMLElement
					? positionOverlay(element, { triggerId, placement: "end top", offset: MENU_OFFSET })
					: () => undefined,
			),
			(release) => Effect.sync(release),
		).pipe(Effect.as(Message.CompletedPositionMenu())),
})

type CaptureContextMenuMessage = Extract<
	Message,
	{ _tag: "CompletedCaptureContextMenu" | "PressedContextMenu" }
>

/** ContextMenuTrigger's `onContextMenu`: open at the pointer, offset from the trigger's bottom left. */
const CaptureContextMenu = Mount.defineStream("CaptureContextMenu", {
	messages: [Message.CompletedCaptureContextMenu, Message.PressedContextMenu],
	execute: ({ element }) =>
		Stream.callback<CaptureContextMenuMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const onContextMenu = (event: Event) => {
						if (!(event instanceof MouseEvent)) return
						event.preventDefault()
						const rect = element.getBoundingClientRect()
						Queue.offerUnsafe(
							queue,
							Message.PressedContextMenu({
								offset: event.clientY - rect.bottom,
								crossOffset: event.clientX - rect.left,
							}),
						)
					}
					element.addEventListener("contextmenu", onContextMenu)
					Queue.offerUnsafe(queue, Message.CompletedCaptureContextMenu())
					return () => element.removeEventListener("contextmenu", onContextMenu)
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

// CONTENT HELPERS

/** `MenuLabel` (DropdownLabel). */
export const menuLabel = <M>(
	h: HtmlBuilder<M>,
	id: string,
	key: string,
	text: string,
	className?: string,
): Html =>
	h.span(
		[
			h.Class(twMerge(dropdownLabelBase, className)),
			h.Id(labelId(id, key)),
			h.Attribute("slot", "label"),
		],
		[text],
	)

/** `MenuDescription` (DropdownDescription). */
export const menuDescription = <M>(h: HtmlBuilder<M>, id: string, key: string, text: string): Html =>
	h.span(
		[
			h.Class(twMerge(dropdownDescriptionBase)),
			h.Id(descriptionId(id, key)),
			h.Attribute("slot", "description"),
		],
		[text],
	)

/** `MenuShortcut` (DropdownKeyboard over Keyboard). */
export const menuShortcut = <M>(h: HtmlBuilder<M>, id: string, key: string, text: string): Html =>
	h.kbd(
		[
			h.Class(twMerge(keyboardStyles, twMerge(dropdownKeyboardBase))),
			h.Attribute("data-slot", "keyboard"),
			h.Attribute("dir", "ltr"),
			h.Id(descriptionId(id, key)),
		],
		[text],
	)

/** `MenuTrigger`'s classes, for an icon trigger that is not a `Button`. */
export const menuTriggerClassName = (className?: string) => twMerge(twMerge(...menuTriggerBase), className)

// VIEW

export type ViewInputs = Readonly<{
	/** Renders the trigger. Spread `attributes` on it and put `overlay` last among its children. */
	toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
	/** The children of one item (icon, label, shortcut, description), or of a section's header. */
	content: (key: string) => ReadonlyArray<Html | string>
	/** `MenuContent` className. */
	className?: string
	/** `MenuContent` popover.className. */
	popoverClassName?: string
	/** A `MenuHeader` before the root menu's entries (e.g. a row of quick actions). */
	header?: Html
	/** A `MenuItem`'s own className, by key. */
	itemClassName?: (key: string) => string | undefined
}>

const popoverClassName = (className?: string) =>
	twMerge(twMerge(...popoverContentBase), twMerge(twMerge(menuPopoverBase), className))

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const isOpen = model.popup._tag === "Open"
	const triggerAttributes = childAttributes([
		h.Id(triggerId(model.id)),
		h.Attribute("aria-haspopup", "true"),
		h.Attribute("aria-expanded", isOpen ? "true" : "false"),
		...(isOpen
			? [h.Attribute("aria-controls", menuId(model.id)), h.Attribute("data-pressed", "true")]
			: []),
		h.OnPointerDown((pointerType, button) =>
			button === 0 ? Option.some(Message.PressedTrigger({ pointerType })) : Option.none(),
		),
		h.OnKeyDownPreventDefault((key) =>
			Array.contains(["Enter", " ", "ArrowDown", "ArrowUp"], key)
				? Option.some(Message.PressedTriggerKey({ key }))
				: Option.none(),
		),
	])
	return viewInputs.toTrigger(
		triggerAttributes,
		model.popup._tag === "Open" ? overlay(model, model.popup, viewInputs, h) : h.empty,
	)
})

/** `ContextMenu` + `ContextMenuTrigger` + `ContextMenuContent`; init the Model with `anchor: "Pointer"`. */
export const contextMenuView = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const triggerAttributes = childAttributes([
		h.Id(triggerId(model.id)),
		h.Attribute("aria-haspopup", "menu"),
		h.OnMount(CaptureContextMenu()),
	])
	return viewInputs.toTrigger(
		triggerAttributes,
		model.popup._tag === "Open" ? overlay(model, model.popup, viewInputs, h) : h.empty,
	)
})

type Open = Extract<Model["popup"], { _tag: "Open" }>

const overlay = (model: Model, open: Open, viewInputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
	const submenu = open.submenu
	const rootFocus = Option.isSome(Option.flatMap(submenu, (opened) => opened.focusedKey))
		? Option.none<string>()
		: open.focusedKey
	const pointerOffset = Option.getOrUndefined(open.pointerOffset)
	const isAtPointer = pointerOffset !== undefined
	const initialFocusId = Option.match(open.focusedKey, {
		onNone: () => (isAtPointer ? popoverId(model.id) : menuId(model.id)),
		onSome: (key) => itemId(model.id, key),
	})
	const toMenuKey = (key: string, modifiers: KeyboardModifiers) =>
		Message.PressedMenuKey({
			key,
			isModified: modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey,
		})

	return h.div(
		[
			h.Attribute("style", "display: contents;"),
			h.OnMount(
				PortalMenu({
					id: model.id,
					placement: isAtPointer ? "bottom left" : model.placement,
					offset: pointerOffset?.offset ?? MENU_OFFSET,
					crossOffset: pointerOffset?.crossOffset ?? 0,
					isTriggerWidthSet: !isAtPointer,
					initialFocusId,
				}),
			),
		],
		[
			h.span([
				h.Attribute("data-focus-scope-start", "true"),
				h.Attribute("hidden", ""),
				h.Attribute("inert", ""),
			]),
			h.div([
				h.Attribute("inert", ""),
				h.Attribute("data-testid", "underlay"),
				h.Attribute("style", "position: fixed; inset: 0px;"),
			]),
			h.div(
				[h.Attribute("style", "display: contents;")],
				[
					h.div(
						[
							...(isAtPointer ? [] : [h.Attribute("aria-labelledby", triggerId(model.id))]),
							h.Class(popoverClassName(viewInputs.popoverClassName)),
							h.Attribute("data-rac", ""),
							...(isAtPointer ? [] : [h.Attribute("data-trigger", "MenuTrigger")]),
							h.Attribute("data-menu-popover", model.id),
							h.Attribute("data-popover", ""),
							h.Attribute("dir", "ltr"),
							...(isAtPointer ? [h.Id(popoverId(model.id))] : []),
							h.Role("dialog"),
							h.Attribute("tabindex", "-1"),
							// NOTE: a ContextMenu's Menu has no autoFocus, so React Aria only sees Escape on the popover.
							h.OnKeyDownPreventDefault((key, modifiers) =>
								!isAtPointer || key === "Escape"
									? Option.some(toMenuKey(key, modifiers))
									: Option.none(),
							),
						],
						[
							dismissButton(h, Message.ClickedDismiss()),
							h.div(
								[h.Class(popoverInnerClassName), h.Attribute("data-slot", "popover-inner")],
								[
									focusScopeSentinel(h, "start"),
									menuElement(h, model, open, viewInputs, {
										className: viewInputs.className,
										elementId: menuId(model.id),
										labelledBy: isAtPointer ? undefined : triggerId(model.id),
										entries: model.entries,
										header: viewInputs.header,
										focusedKey: rootFocus,
										onKeyDown: isAtPointer ? toMenuKey : undefined,
									}),
									focusScopeSentinel(h, "end"),
								],
							),
							dismissButton(h, Message.ClickedDismiss()),
						],
					),
					...Option.match(submenu, {
						onNone: () => [],
						onSome: (opened) => [
							focusScopeSentinel(h, "start"),
							submenuPopover(h, model, open, viewInputs, opened.triggerKey, opened.focusedKey),
							focusScopeSentinel(h, "end"),
						],
					}),
				],
			),
			h.span([
				h.Attribute("data-focus-scope-end", "true"),
				h.Attribute("hidden", ""),
				h.Attribute("inert", ""),
			]),
		],
	)
}

const submenuPopover = (
	h: HtmlBuilder<Message>,
	model: Model,
	open: Open,
	viewInputs: ViewInputs,
	triggerKey: string,
	focusedKey: Option.Option<string>,
): Html => {
	const trigger = Array.findFirst(rootItems(model), (candidate) => candidate.key === triggerKey)
	const leaves = Option.match(trigger, { onNone: () => [], onSome: (found) => found.submenu })
	return h.div(
		[
			h.Attribute("aria-labelledby", itemId(model.id, triggerKey)),
			h.Class(popoverClassName(undefined)),
			h.Attribute("data-rac", ""),
			h.Attribute("data-trigger", "SubmenuTrigger"),
			h.Attribute("data-menu-popover", model.id),
			h.Attribute("dir", "ltr"),
			h.Role("dialog"),
			h.Attribute("tabindex", "-1"),
			h.OnMount(PositionSubmenu({ triggerId: itemId(model.id, triggerKey) })),
		],
		[
			h.div(
				[h.Class(popoverInnerClassName), h.Attribute("data-slot", "popover-inner")],
				[
					focusScopeSentinel(h, "start"),
					menuElement(h, model, open, viewInputs, {
						className: undefined,
						elementId: submenuId(model.id),
						labelledBy: itemId(model.id, triggerKey),
						entries: Array.map(leaves, (leaf) => ({
							_tag: "Item" as const,
							item: { ...leaf, submenu: [] },
						})),
						focusedKey,
					}),
					focusScopeSentinel(h, "end"),
				],
			),
			dismissButton(h, Message.ClickedDismiss()),
		],
	)
}

type MenuLevel = Readonly<{
	className: string | undefined
	elementId: string
	labelledBy: string | undefined
	entries: ReadonlyArray<Entry>
	header?: Html | undefined
	focusedKey: Option.Option<string>
	onKeyDown?: (key: string, modifiers: KeyboardModifiers) => Message
}>

const menuElement = (
	h: HtmlBuilder<Message>,
	model: Model,
	open: Open,
	viewInputs: ViewInputs,
	level: MenuLevel,
): Html => {
	const { section, header } = dropdownSectionStyles()
	const itemView = (entry: Leaf & Readonly<{ submenu: ReadonlyArray<Leaf> }>) =>
		menuItem(h, model, open, viewInputs, entry, level.focusedKey)
	return h.div(
		[
			...(level.labelledBy ? [h.Attribute("aria-labelledby", level.labelledBy)] : []),
			h.Class(menuContentStyles({ className: level.className })),
			h.Attribute("data-rac", ""),
			h.Attribute("data-slot", "menu-content"),
			h.Id(level.elementId),
			h.Role("menu"),
			h.Attribute("tabindex", Option.isSome(level.focusedKey) ? "-1" : "0"),
			...(level.onKeyDown
				? [
						h.OnKeyDownPreventDefault((key, modifiers) =>
							key === "Escape" || !level.onKeyDown
								? Option.none()
								: Option.some(level.onKeyDown(key, modifiers)),
						),
					]
				: []),
		],
		[
			...(level.header ? [level.header] : []),
			...Array.map(level.entries, (entry, index) => {
				if (entry._tag === "Item") return itemView(entry.item)
				if (entry._tag === "Separator")
					return h.div([h.Class(twMerge(dropdownSeparatorBase)), h.Role("separator")])
				const labelId = `${level.elementId}-section-${index}`
				const sectionHeader = Option.map(entry.header, (found) => ({
					...found,
					id: headerId(model.id, found.key),
				}))
				const labelledBy = Option.isSome(sectionHeader)
					? Option.some(sectionHeader.value.id)
					: Option.as(entry.label, labelId)
				return h.section(
					[
						...Option.match(labelledBy, {
							onNone: () => [],
							onSome: (id) => [h.Attribute("aria-labelledby", id)],
						}),
						h.Class(section()),
						h.Attribute("data-rac", ""),
						h.Role("group"),
					],
					[
						...Option.match(sectionHeader, {
							onNone: () => [],
							onSome: (found) => [
								h.header(
									[
										h.Class(
											twMerge(
												menuHeaderBase,
												found.hasSeparator && menuHeaderSeparator,
											),
										),
										h.Id(found.id),
										h.Role("presentation"),
									],
									viewInputs.content(found.key),
								),
							],
						}),
						...Option.match(entry.label, {
							onNone: () => [],
							onSome: (label) => [
								h.header([h.Class(header()), h.Id(labelId), h.Role("presentation")], [label]),
							],
						}),
						...Array.map(entry.items, itemView),
					],
				)
			}),
		],
	)
}

const legacyIntents = { Danger: "danger", Warning: "warning", None: undefined } as const

const menuItem = (
	h: HtmlBuilder<Message>,
	model: Model,
	open: Open,
	viewInputs: ViewInputs,
	entry: Leaf & Readonly<{ submenu: ReadonlyArray<Leaf> }>,
	levelFocusedKey: Option.Option<string>,
): Html => {
	const { key } = entry
	const hasSubmenu = Array.isReadonlyArrayNonEmpty(entry.submenu)
	const isSubmenuOpen = Option.exists(open.submenu, (submenu) => submenu.triggerKey === key)
	const isFocused = Option.contains(levelFocusedKey, key)
	const isHovered = !entry.isDisabled && Option.contains(open.hoveredKey, key)
	const isFocusVisible = isFocused && open.modality === "Keyboard"
	const isSelectable = model.selectionMode === "Single"
	const isSelected = isSelectable && Array.contains(model.selectedKeys, key)
	const intent = Option.getOrUndefined(entry.intent)
	const legacyIntent = legacyIntents[intent ?? "None"]
	const ownClassName = viewInputs.itemClassName?.(key)
	const className = hasSubmenu
		? twMerge(
				legacyIntent === "danger" && menuItemSubmenuOpen.danger,
				legacyIntent === "warning" && menuItemSubmenuOpen.warning,
				legacyIntent === undefined && menuItemSubmenuOpen.none,
				ownClassName,
			)
		: ownClassName
	const flag = (name: string, isOn: boolean) => (isOn ? [h.Attribute(name, "true")] : [])
	const href = Option.getOrUndefined(entry.href)

	return h.keyed(href === undefined ? "div" : "a")(
		key,
		[
			...(isSelectable ? [h.Attribute("aria-checked", isSelected ? "true" : "false")] : []),
			...(entry.isDisabled ? [h.Attribute("aria-disabled", "true")] : []),
			...(hasSubmenu
				? [
						...(isSubmenuOpen ? [h.Attribute("aria-controls", submenuId(model.id))] : []),
						h.Attribute("aria-expanded", isSubmenuOpen ? "true" : "false"),
						h.Attribute("aria-haspopup", "menu"),
					]
				: []),
			...(entry.hasDescription ? [h.Attribute("aria-describedby", descriptionId(model.id, key))] : []),
			h.Attribute("aria-labelledby", labelId(model.id, key)),
			h.Class(
				dropdownItemStyles({
					isFocused,
					isHovered,
					isDisabled: entry.isDisabled,
					isSelected,
					intent: legacyIntent,
					className,
				}),
			),
			...flag("data-disabled", entry.isDisabled),
			...flag("data-focus-visible", isFocusVisible),
			...flag("data-focused", isFocused),
			...flag("data-has-submenu", hasSubmenu),
			...flag("data-hovered", isHovered),
			...flag("data-open", isSubmenuOpen),
			h.Attribute("data-rac", ""),
			h.Attribute("data-react-aria-pressable", "true"),
			...flag("data-selected", isSelected),
			...(isSelectable ? [h.Attribute("data-selection-mode", "single")] : []),
			h.Attribute("data-slot", "menu-item"),
			...(href === undefined ? [] : [h.Href(href)]),
			h.Id(itemId(model.id, key)),
			h.Role(isSelectable ? "menuitemradio" : "menuitem"),
			...(entry.isDisabled ? [] : [h.Attribute("tabindex", isFocused ? "0" : "-1")]),
			h.OnMouseEnter(Message.HoveredItem({ key })),
			h.OnMouseLeave(Message.UnhoveredItem({ key })),
			h.OnClick(Message.ClickedItem({ key })),
		],
		[
			...(isSelected
				? [
						IconCheck(h, {
							className: dropdownCheckIndicatorClassName,
							attributes: { "data-slot": "check-indicator" },
						}),
					]
				: []),
			...viewInputs.content(key),
			...(hasSubmenu
				? [
						IconChevronRight(h, {
							className: menuChevronClassName,
							attributes: { "data-slot": "chevron" },
						}),
					]
				: []),
		],
	)
}
