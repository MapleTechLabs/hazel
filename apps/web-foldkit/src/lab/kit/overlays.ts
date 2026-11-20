import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import {
	IconBell,
	IconChevronDown,
	IconCopy,
	IconDots,
	IconEnvelope,
	IconGear,
	IconHashtag,
	IconPlus,
	IconShare,
	IconSlack,
	IconStar,
	IconTrash,
	IconUsers,
	IconUsersPlus,
} from "../../icons"
import { button } from "../../ui/button"
import type * as CommandMenu from "../../ui/command-menu"
import {
	commandMenuDescription,
	commandMenuShortcut,
	view as commandMenuView,
} from "../../ui/command-menu-view"
import {
	dialogBody,
	dialogClose,
	dialogDescription,
	dialogFooter,
	dialogHeader,
	dialogTitle,
} from "../../ui/dialog"
import { shortcut } from "../../ui/kbd"
import * as Menu from "../../ui/menu"
import {
	contextMenuView,
	menuDescription,
	menuKeyboard,
	menuLabel,
	view as menuView,
} from "../../ui/menu-view"
import * as Modal from "../../ui/modal"
import * as Popover from "../../ui/popover"
import * as Sheet from "../../ui/sheet"
import { switchControl } from "../../ui/switch"
import { textField } from "../../ui/text-field"
import { kitSection, pair, specimen } from "./chrome"
import { Message, type Model } from "./model"

type H = HtmlBuilder<Message>

// MENUS

const MENU_ENTRIES: ReadonlyArray<Menu.Entry> = [
	Menu.section("Channel", [
		Menu.item("mute", { textValue: "Mute channel" }),
		Menu.item("copy", { textValue: "Copy link" }),
		Menu.item("favorite", { textValue: "Add to favorites" }),
	]),
	Menu.separator,
	Menu.item("share", {
		textValue: "Share",
		submenu: [Menu.leaf("email", { textValue: "Email" }), Menu.leaf("slack", { textValue: "Slack" })],
	}),
	Menu.item("members", { textValue: "Members", hasDescription: true }),
	Menu.item("settings", { textValue: "Settings", isDisabled: true }),
	Menu.separator,
	Menu.item("delete", { textValue: "Delete channel", intent: "Danger" }),
]

type MenuRow = Readonly<{
	label: string
	icon: (h: H) => Html
	keys?: string
	description?: string
}>

const MENU_ROWS: ReadonlyMap<string, MenuRow> = new Map([
	["mute", { label: "Mute channel", icon: IconBell, keys: "⌘M" }],
	["copy", { label: "Copy link", icon: IconCopy, keys: "⌘L" }],
	["favorite", { label: "Add to favorites", icon: IconStar }],
	["share", { label: "Share", icon: IconShare }],
	["email", { label: "Email", icon: IconEnvelope }],
	["slack", { label: "Slack", icon: IconSlack }],
	["members", { label: "Members", icon: IconUsers, description: "42 people, 3 guests" }],
	["settings", { label: "Settings", icon: IconGear }],
	["delete", { label: "Delete channel", icon: IconTrash, keys: "⌘⌫" }],
])

const menuContent =
	(h: H, menuId: string) =>
	(key: string): ReadonlyArray<Html | string> => {
		const row = MENU_ROWS.get(key)
		if (row === undefined) return [menuLabel(h, menuId, key, key)]
		return [
			row.icon(h),
			menuLabel(h, menuId, key, row.label),
			...(row.description === undefined ? [] : [menuDescription(h, menuId, key, row.description)]),
			...(row.keys === undefined ? [] : [menuKeyboard(h, row.keys)]),
		]
	}

const SORT_ENTRIES: ReadonlyArray<Menu.Entry> = [
	Menu.section("Sort by", [
		Menu.item("recent", { textValue: "Most recent" }),
		Menu.item("unread", { textValue: "Unread first" }),
		Menu.item("name", { textValue: "Name" }),
	]),
]

const SORT_LABELS: ReadonlyMap<string, string> = new Map([
	["recent", "Most recent"],
	["unread", "Unread first"],
	["name", "Name"],
])

const CONTEXT_ENTRIES: ReadonlyArray<Menu.Entry> = [
	Menu.item("copy", { textValue: "Copy link" }),
	Menu.item("favorite", { textValue: "Add to favorites" }),
	Menu.separator,
	Menu.item("delete", { textValue: "Delete channel", intent: "Danger" }),
]

const menus = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Menu",
			file: "ui/menu.ts",
			note: "Actions on the thing it opens from. Sections, one submenu level, a shortcut at the row's end, danger last.",
			className: "items-start gap-3",
		},
		[
			h.submodel({
				slotId: model.menu.id,
				model: model.menu,
				view: menuView,
				viewInputs: {
					entries: MENU_ENTRIES,
					content: menuContent(h, model.menu.id),
					popoverClassName: "min-w-56",
					toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) =>
						button(h, { intent: "outline", attributes }, [
							"Channel",
							IconChevronDown(h),
							overlay,
						]),
				},
				toParentMessage: (message: Menu.Message) => Message.GotMenuMessage({ message }),
			}),
			h.submodel({
				slotId: model.sortMenu.id,
				model: model.sortMenu,
				view: menuView,
				viewInputs: {
					entries: SORT_ENTRIES,
					content: (key: string) => [
						menuLabel(h, model.sortMenu.id, key, SORT_LABELS.get(key) ?? key),
					],
					popoverClassName: "min-w-44",
					toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) =>
						button(h, { intent: "plain", attributes }, [
							SORT_LABELS.get(model.sortMenu.selectedKeys[0] ?? "recent") ?? "Sort",
							IconChevronDown(h),
							overlay,
						]),
				},
				toParentMessage: (message: Menu.Message) => Message.GotSortMenuMessage({ message }),
			}),
			h.submodel({
				slotId: model.contextMenu.id,
				model: model.contextMenu,
				view: contextMenuView,
				viewInputs: {
					entries: CONTEXT_ENTRIES,
					content: menuContent(h, model.contextMenu.id),
					popoverClassName: "min-w-48",
					toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) =>
						h.div(
							[
								...attributes,
								h.Class(
									"flex h-9 items-center gap-2 rounded-lg border border-border border-dashed px-3 text-fg-2 text-sm",
								),
							],
							[IconDots(h, { className: "size-4" }), "Right-click here", overlay],
						),
				},
				toParentMessage: (message: Menu.Message) => Message.GotContextMenuMessage({ message }),
			}),
		],
	)

// POPOVER

const popovers = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Popover",
			file: "ui/popover.ts",
			note: "A small panel for a few related settings. Escape or a press outside closes it.",
		},
		[
			h.submodel({
				slotId: model.popover.id,
				model: model.popover,
				view: Popover.view,
				viewInputs: {
					placement: "bottom start",
					className: "w-80",
					toTrigger: (attributes) =>
						button(h, { intent: "outline", attributes }, [IconBell(h), "Notifications"]),
					toContent: (closeAttributes) => [
						h.div(
							[h.Class("flex flex-col gap-4 p-4")],
							[
								h.div(
									[h.Class("flex flex-col gap-1")],
									[
										dialogTitle(h, {}, "Notifications"),
										dialogDescription(h, "Choose when this channel notifies you."),
									],
								),
								switchControl(
									h,
									{
										id: "kit-popover-sounds",
										isSelected: model.switches.includes("sounds"),
										onChange: (isSelected) =>
											Message.ToggledSwitch({ key: "sounds", isSelected }),
									},
									"Notification sounds",
								),
								h.div(
									[h.Class("flex justify-end")],
									[dialogClose(h, closeAttributes, ["Done"], "secondary")],
								),
							],
						),
					],
				},
				toParentMessage: (message: Popover.Message) => Message.GotPopoverMessage({ message }),
			}),
		],
	)

// DIALOGS

const renameModal = (h: H, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.modal,
		size: "md",
		toParentMessage: (message) => Message.GotModalMessage({ message }),
		toContent: (closeAttributes) => [
			dialogHeader(h, {
				title: { id: Modal.titleId(model.modal.id), text: "Rename channel" },
				description: "Everyone in the channel sees the new name right away.",
			}),
			dialogBody(h, [
				textField(
					h,
					{
						id: "kit-modal-name",
						value: model.name,
						onInput: (value) => Message.ChangedText({ field: "name", value }),
					},
					(parts) => [parts.label(["Name"]), parts.input({ placeholder: "channel-name" })],
				),
			]),
			dialogFooter(h, [
				dialogClose(h, closeAttributes, ["Cancel"]),
				dialogClose(h, closeAttributes, ["Rename"], "primary"),
			]),
		],
	})

const deleteAlert = (h: H, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.alert,
		size: "sm",
		role: "alertdialog",
		toParentMessage: (message) => Message.GotAlertMessage({ message }),
		toContent: (closeAttributes) => [
			dialogHeader(h, {
				title: { id: Modal.titleId(model.alert.id), text: "Delete #design?" },
				description:
					"Its 1,204 messages and 38 files are removed for everyone. This can't be undone.",
			}),
			dialogFooter(h, [
				dialogClose(h, closeAttributes, ["Keep it"]),
				dialogClose(h, closeAttributes, ["Delete channel"], "danger"),
			]),
		],
	})

const detailsSheet = (h: H, model: Model): Html =>
	h.submodel({
		slotId: model.sheet.id,
		model: model.sheet,
		view: Sheet.view,
		viewInputs: {
			side: "right",
			toContent: (closeAttributes) => [
				dialogHeader(h, {
					title: { id: Modal.titleId(model.sheet.id), text: "Channel details" },
					description: "#general · 42 members",
				}),
				dialogBody(h, [
					h.p(
						[h.Class("text-fg-3 text-sm")],
						["Company-wide announcements and the things everyone should see."],
					),
				]),
				dialogFooter(h, [dialogClose(h, closeAttributes, ["Done"], "secondary")]),
			],
		},
		toParentMessage: (message: Modal.Message) => Message.GotSheetMessage({ message }),
	})

const dialogs = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Modal, alert and sheet",
			file: "ui/modal.ts · ui/dialog.ts · ui/sheet.ts",
			note: "A modal for a task, an alert to confirm a loss (it has no close button), a sheet for detail beside the page.",
		},
		[
			button(h, { intent: "outline", onPress: Message.PressedOpenDialog({ dialog: "modal" }) }, [
				"Open modal",
			]),
			button(h, { intent: "outline", onPress: Message.PressedOpenDialog({ dialog: "alert" }) }, [
				"Open alert",
			]),
			button(h, { intent: "outline", onPress: Message.PressedOpenDialog({ dialog: "sheet" }) }, [
				"Open sheet",
			]),
			renameModal(h, model),
			deleteAlert(h, model),
			detailsSheet(h, model),
		],
	)

// COMMAND MENU

type CommandRow = Readonly<{
	label: string
	icon: (h: H) => Html
	description?: string
	keys?: string
}>

const COMMAND_ROWS: ReadonlyMap<string, CommandRow> = new Map([
	["general", { label: "general", icon: IconHashtag }],
	["design", { label: "design", icon: IconHashtag, description: "12 members" }],
	["create-channel", { label: "Create channel", icon: IconPlus, keys: "⌘⌥N" }],
	["invite", { label: "Invite people", icon: IconUsersPlus, keys: "⌘⌥I" }],
	["set-status", { label: "Set status", icon: IconBell }],
])

const commandMenu = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Command menu",
			file: "ui/command-menu.ts",
			note: "Every page and action, one search away. Typing filters, arrows move, Enter runs.",
		},
		[
			button(h, { intent: "outline", onPress: Message.PressedOpenCommand() }, [
				"Open command menu",
				shortcut(h, { size: "sm" }, ["⌘", "K"]),
			]),
			h.submodel({
				slotId: model.command.id,
				model: model.command,
				view: commandMenuView,
				viewInputs: {
					placeholder: "Where would you like to go?",
					content: (key: string) => {
						const row = COMMAND_ROWS.get(key)
						if (row === undefined) return [menuLabel(h, model.command.id, key, key)]
						return [
							row.icon(h),
							menuLabel(h, model.command.id, key, row.label),
							...(row.description === undefined
								? []
								: [commandMenuDescription(h, model.command.id, key, row.description)]),
							...(row.keys === undefined
								? []
								: [commandMenuShortcut(h, model.command.id, key, row.keys)]),
						]
					},
				},
				toParentMessage: (message: CommandMenu.Message) => Message.GotCommandMessage({ message }),
			}),
		],
	)

export const overlays = (h: H, model: Model): Html =>
	kitSection(h, "overlays", [
		menus(h, model),
		pair(h, [popovers(h, model), commandMenu(h, model)]),
		dialogs(h, model),
	])
