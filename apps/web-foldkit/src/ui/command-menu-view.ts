import { Array, Effect, Option, Queue, Schema, Stream } from "effect"
import { Mount, Submodel } from "foldkit"
import { type ChildAttribute, childAttributes, type Html, type HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	type CommandMenuSize,
	commandMenuContentsClassName,
	commandMenuDescriptionBase,
	commandMenuDialogClassName,
	commandMenuEmptyClassName,
	commandMenuEscapeClassName,
	commandMenuInputClassName,
	commandMenuItemBase,
	commandMenuListBase,
	commandMenuModalBase,
	commandMenuOverlayClassName,
	commandMenuSearchBase,
	commandMenuSearchIconClassName,
	commandMenuSectionBase,
	commandMenuSectionHeaderClassName,
	commandMenuShortcutBase,
} from "~/components/ui/command-menu.styles"
import {
	dropdownDescriptionBase,
	dropdownItemStyles,
	dropdownKeyboardBase,
} from "~/components/ui/dropdown.styles"
import { keyboardStyles } from "~/components/ui/keyboard.styles"
import { IconMagnifier3 } from "../icons"
import {
	containFocus,
	dismissButton,
	focusScopeSentinel,
	portalOverlay,
	restoreFocusToPrevious,
	trackViewportHeight,
	watchInteractOutside,
} from "./aria/overlay"
import {
	dialogId,
	type Item,
	itemId,
	listId,
	Message,
	type Model,
	searchId,
	visibleSections,
} from "./command-menu"
import { descriptionId, labelId } from "./menu"

// MOUNT

type PortalCommandMenuMessage = Extract<Message, { _tag: "CompletedPortalCommandMenu" | "PressedOutside" }>

export const PortalCommandMenu = Mount.defineStream("PortalCommandMenu", {
	args: { id: Schema.String, isDismissable: Schema.Boolean },
	messages: [Message.CompletedPortalCommandMenu, Message.PressedOutside],
	execute: ({ element, id, isDismissable }) =>
		Stream.callback<PortalCommandMenuMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const restoreFocus = restoreFocusToPrevious(element)
					const releasePortal = portalOverlay(element, { isModal: true })
					const overlay = element.querySelector<HTMLElement>("[data-modal-overlay]")
					const releaseViewport = overlay ? trackViewportHeight(overlay) : () => undefined
					;(document.getElementById(searchId(id)) ?? document.getElementById(dialogId(id)))?.focus({
						preventScroll: true,
					})
					const releaseFocus = containFocus(element)
					const releaseOutside = isDismissable
						? watchInteractOutside(`[data-modal-content="${CSS.escape(id)}"]`, () =>
								Queue.offerUnsafe(queue, Message.PressedOutside()),
							)
						: () => undefined
					Queue.offerUnsafe(queue, Message.CompletedPortalCommandMenu())
					return () => {
						releaseOutside()
						releaseFocus()
						releaseViewport()
						releasePortal()
						restoreFocus()
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})

// CONTENT HELPERS

/** `CommandMenuDescription`. */
export const commandMenuDescription = <M>(h: HtmlBuilder<M>, id: string, key: string, text: string): Html =>
	h.span(
		[
			h.Class(twMerge(dropdownDescriptionBase, twMerge(commandMenuDescriptionBase))),
			h.Id(descriptionId(id, key)),
			h.Attribute("slot", "description"),
		],
		[text],
	)

/** `CommandMenuShortcut`. */
export const commandMenuShortcut = <M>(h: HtmlBuilder<M>, id: string, key: string, text: string): Html =>
	h.kbd(
		[
			h.Class(twMerge(keyboardStyles, twMerge(dropdownKeyboardBase, twMerge(commandMenuShortcutBase)))),
			h.Attribute("data-slot", "keyboard"),
			h.Attribute("dir", "ltr"),
			h.Id(descriptionId(id, key)),
		],
		[text],
	)

// VIEW

export type ViewInputs = Readonly<{
	/** The children of one CommandMenuItem (icon, label, description, shortcut). */
	content: (key: string) => ReadonlyArray<Html>
	placeholder?: string
	size?: CommandMenuSize
	isDismissable?: boolean
	isBlurred?: boolean
	escapeButton?: boolean
	className?: string
	"aria-label"?: string
	/** CommandMenu `isFormPage`: render these instead of the search field and list. */
	toFormPage?: (closeAttributes: ReadonlyArray<ChildAttribute>) => ReadonlyArray<Html>
}>

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) =>
	model.isOpen ? commandMenuOverlay(model, viewInputs, h) : h.empty,
)

const commandMenuOverlay = (model: Model, viewInputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
	const isDismissable = viewInputs.isDismissable ?? true
	return h.div(
		[
			h.Attribute("style", "display: contents;"),
			h.OnMount(PortalCommandMenu({ id: model.id, isDismissable })),
			// NOTE: on list pages the search field owns Escape (clear first, then close).
			h.OnKeyDownPreventDefault((key) =>
				key === "Escape" && viewInputs.toFormPage
					? Option.some(Message.ClickedEscapeButton())
					: Option.none(),
			),
		],
		[
			h.span([
				h.Attribute("data-focus-scope-start", "true"),
				h.Attribute("hidden", ""),
				h.Attribute("inert", ""),
			]),
			h.div(
				[
					h.Class(commandMenuOverlayClassName(viewInputs.isBlurred ?? false)),
					h.Attribute("data-modal-overlay", ""),
					h.Attribute("data-rac", ""),
				],
				[
					h.div(
						[
							h.Class(
								twMerge(
									twMerge(...commandMenuModalBase(viewInputs.size ?? "lg")),
									viewInputs.className,
								),
							),
							h.Attribute("data-modal-content", model.id),
							h.Attribute("data-rac", ""),
						],
						[
							...(isDismissable ? [dismissButton(h, Message.ClickedDismiss())] : []),
							h.section(
								[
									h.Attribute("aria-label", viewInputs["aria-label"] ?? "Command Menu"),
									h.Class(commandMenuDialogClassName),
									h.Attribute("data-rac", ""),
									h.Id(dialogId(model.id)),
									h.Role("dialog"),
									h.Attribute("tabindex", "-1"),
								],
								[
									h.div(
										[h.Class(commandMenuContentsClassName)],
										viewInputs.toFormPage
											? viewInputs.toFormPage(
													childAttributes([
														h.OnClick(Message.ClickedEscapeButton()),
													]),
												)
											: [
													searchField(model, viewInputs, h),
													focusScopeSentinel(h, "start"),
													list(model, viewInputs, h),
													focusScopeSentinel(h, "end"),
												],
									),
								],
							),
						],
					),
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

const searchField = (model: Model, viewInputs: ViewInputs, h: HtmlBuilder<Message>): Html =>
	h.div(
		[
			h.Class(twMerge(twMerge(commandMenuSearchBase), undefined)),
			...(model.inputValue === "" ? [h.Attribute("data-empty", "true")] : []),
			h.Attribute("data-rac", ""),
		],
		[
			IconMagnifier3(h, {
				className: commandMenuSearchIconClassName,
				attributes: { "data-slot": "command-menu-search-icon" },
			}),
			h.input([
				...Option.match(model.focusedKey, {
					onNone: () => [],
					onSome: (key) => [h.Attribute("aria-activedescendant", itemId(model.id, key))],
				}),
				h.Attribute("aria-autocomplete", "list"),
				h.Attribute("aria-controls", listId(model.id)),
				h.Attribute("aria-label", "Quick search"),
				h.Attribute("autocomplete", "off"),
				h.Attribute("autocorrect", "off"),
				h.Class(commandMenuInputClassName),
				h.Attribute("enterkeyhint", "go"),
				h.Id(searchId(model.id)),
				h.Attribute("placeholder", viewInputs.placeholder ?? "Search..."),
				h.Attribute("spellcheck", "false"),
				h.Attribute("tabindex", "0"),
				h.Attribute("type", "search"),
				h.Value(model.inputValue),
				h.OnInput((value) => Message.ChangedSearch({ value })),
				h.OnKeyDownPreventDefault((key) =>
					Array.contains(["ArrowDown", "ArrowUp", "Enter", "Escape"], key)
						? Option.some(Message.PressedSearchKey({ key }))
						: Option.none(),
				),
			]),
			...((viewInputs.escapeButton ?? true)
				? [
						h.button(
							[
								h.Attribute("aria-label", "Clear search"),
								h.Class(commandMenuEscapeClassName),
								h.Attribute("data-react-aria-pressable", "true"),
								h.Attribute("tabindex", "-1"),
								h.Attribute("type", "button"),
								h.OnClick(Message.ClickedEscapeButton()),
							],
							["Esc"],
						),
					]
				: []),
		],
	)

const list = (model: Model, viewInputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
	const sections = visibleSections(model)
	const isEmpty = !Array.isReadonlyArrayNonEmpty(sections)
	return h.div(
		[
			h.Attribute("aria-label", "Suggestions"),
			h.Class(twMerge(twMerge(commandMenuListBase), undefined)),
			...(isEmpty ? [h.Attribute("data-empty", "true")] : []),
			h.Attribute("data-rac", ""),
			h.Id(listId(model.id)),
			h.Role("menu"),
		],
		isEmpty
			? [h.div([h.Class(commandMenuEmptyClassName)], ["No results found."])]
			: Array.map(sections, (entry, index) => {
					const headerId = `${listId(model.id)}-section-${index}`
					return h.section(
						[
							...(Option.isSome(entry.label) ? [h.Attribute("aria-labelledby", headerId)] : []),
							h.Class(twMerge(commandMenuSectionBase, undefined)),
							h.Attribute("data-rac", ""),
							h.Role("group"),
						],
						[
							...Option.match(entry.label, {
								onNone: () => [],
								onSome: (label) => [
									h.header(
										[
											h.Class(commandMenuSectionHeaderClassName),
											h.Id(headerId),
											h.Role("presentation"),
										],
										[label],
									),
								],
							}),
							...Array.map(entry.items, (candidate) =>
								menuItem(model, viewInputs, candidate, h),
							),
						],
					)
				}),
	)
}

const menuItem = (model: Model, viewInputs: ViewInputs, candidate: Item, h: HtmlBuilder<Message>): Html => {
	const { key } = candidate
	const isFocused = Option.contains(model.focusedKey, key)
	const isHovered = Option.contains(model.hoveredKey, key)
	const flag = (name: string, isOn: boolean) => (isOn ? [h.Attribute(name, "true")] : [])
	return h.keyed("div")(
		key,
		[
			...(candidate.hasDescription
				? [h.Attribute("aria-describedby", descriptionId(model.id, key))]
				: []),
			h.Attribute("aria-labelledby", labelId(model.id, key)),
			h.Class(
				dropdownItemStyles({
					isFocused,
					isHovered,
					className: twMerge(twMerge(commandMenuItemBase), undefined),
				}),
			),
			...flag("data-focus-visible", isFocused && model.modality === "Keyboard"),
			...flag("data-focused", isFocused),
			...flag("data-hovered", isHovered),
			h.Attribute("data-rac", ""),
			h.Attribute("data-react-aria-pressable", "true"),
			h.Attribute("data-slot", "menu-item"),
			h.Id(itemId(model.id, key)),
			h.Role("menuitem"),
			h.OnMouseEnter(Message.HoveredItem({ key })),
			h.OnMouseLeave(Message.UnhoveredItem({ key })),
			h.OnClick(Message.ClickedItem({ key })),
		],
		viewInputs.content(key),
	)
}
