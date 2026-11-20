import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Toaster from "../../overlay/toaster"
import * as Calendar from "../../ui/calendar"
import * as ChoiceBox from "../../ui/choice-box"
import * as ComboBox from "../../ui/combo-box"
import * as CommandMenu from "../../ui/command-menu"
import * as DatePicker from "../../ui/date-picker"
import * as Segments from "../../ui/date-segments"
import * as Menu from "../../ui/menu"
import * as Modal from "../../ui/modal"
import * as Popover from "../../ui/popover"
import * as Select from "../../ui/select"
import * as Slider from "../../ui/slider"
import * as Tabs from "../../ui/tabs"
import * as Toolbar from "../../ui/toolbar"
import * as Tooltip from "../../ui/tooltip"

/**
 * `/lab/kit`: every `src/ui` component on one page, live. One flat Model: each stateful component is a
 * field, each of its Messages a `Got…Message`, so the page reads like any page that embeds the kit.
 */

/** The lab's "today": fixed, so the calendar and the date fields never read the clock. */
export const TODAY = "2026-11-10"

export const SettingsTab = Schema.Literals(["general", "members", "billing"])
export type SettingsTab = typeof SettingsTab.Type
export const SettingsTabs = Tabs.create<SettingsTab>()

export const TextField = Schema.Literals(["name", "email", "about", "search"])
export type TextField = typeof TextField.Type

export const Dialog = Schema.Literals(["modal", "alert", "sheet"])
export type Dialog = typeof Dialog.Type

export const ToastKind = Schema.Literals(["success", "error", "info", "warning", "loading"])
export type ToastKind = typeof ToastKind.Type

// OPTIONS

export const ROLE_ITEMS: ReadonlyArray<Select.Item> = [
	Select.item("owner", "Owner"),
	Select.item("admin", "Admin"),
	Select.item("member", "Member"),
	Select.item("guest", "Guest", true),
]

export const CHANNEL_ITEMS: ReadonlyArray<ComboBox.Item> = [
	ComboBox.item("general", "general"),
	ComboBox.item("design", "design"),
	ComboBox.item("engineering", "engineering"),
	ComboBox.item("product-updates", "product-updates"),
	ComboBox.item("random", "random"),
	ComboBox.item("archive", "archive", true),
]

export const COMMAND_SECTIONS: ReadonlyArray<CommandMenu.Section> = [
	CommandMenu.section("Recent", [
		CommandMenu.item("general", "general"),
		CommandMenu.item("design", "design", true),
	]),
	CommandMenu.section("Actions", [
		CommandMenu.item("create-channel", "create channel"),
		CommandMenu.item("invite", "invite people"),
		CommandMenu.item("set-status", "set status"),
	]),
]

// MODEL

export const Model = Schema.Struct({
	// Actions
	pressedChips: Schema.Array(Schema.String),
	// Fields
	name: Schema.String,
	email: Schema.String,
	about: Schema.String,
	search: Schema.String,
	role: Select.Model,
	channel: ComboBox.Model,
	dueDate: DatePicker.Model,
	startDate: Segments.Model,
	reminder: Segments.Model,
	// Selection
	checked: Schema.Array(Schema.String),
	switches: Schema.Array(Schema.String),
	notify: Schema.String,
	volume: Schema.Finite,
	volumeSlider: Slider.Model,
	plan: ChoiceBox.Model,
	addons: ChoiceBox.Model,
	calendar: Calendar.Model,
	// Navigation
	tabs: Tabs.Model,
	tab: SettingsTab,
	routeTab: Schema.String,
	toolbar: Toolbar.Model,
	// Overlays
	modal: Modal.Model,
	alert: Modal.Model,
	sheet: Modal.Model,
	popover: Popover.Model,
	tooltip: Tooltip.Model,
	tooltipInverse: Tooltip.Model,
	menu: Menu.Model,
	sortMenu: Menu.Model,
	contextMenu: Menu.Model,
	command: CommandMenu.Model,
	toaster: Toaster.Model,
	/** What the last interaction reported: proof the specimens are live. */
	lastEvent: Schema.String,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
	pressedChips: ["mon", "wed", "fri"],
	name: "Ada Lovelace",
	email: "ada@hazel",
	about: "",
	search: "",
	role: Select.init({ id: "kit-role", selectedKey: "admin" }),
	channel: ComboBox.init({ id: "kit-channel", items: CHANNEL_ITEMS, isAppleDevice: false }),
	dueDate: DatePicker.init({ id: "kit-due", today: TODAY, value: "2026-11-18", minValue: TODAY }),
	startDate: Segments.init({ id: "kit-start", kind: "date", today: TODAY, value: TODAY }),
	reminder: Segments.init({ id: "kit-reminder", kind: "time", value: "09:30" }),
	checked: ["mentions"],
	switches: ["sounds"],
	notify: "mentions",
	volume: 0.6,
	volumeSlider: Slider.init({ id: "kit-volume", min: 0, max: 1, step: 0.1 }),
	plan: ChoiceBox.init({ id: "kit-plan", selectedKeys: ["pro"] }),
	addons: ChoiceBox.init({ id: "kit-addons", selectionMode: "multiple", selectedKeys: ["sso"] }),
	calendar: Calendar.init({ id: "kit-calendar", today: TODAY, value: "2026-11-18" }),
	tabs: Tabs.init({ id: "kit-tabs" }),
	tab: "general",
	routeTab: "messages",
	toolbar: Toolbar.init({ label: "Formatting" }),
	modal: Modal.init("kit-modal"),
	alert: Modal.init("kit-alert"),
	sheet: Modal.init("kit-sheet"),
	popover: Popover.init("kit-popover"),
	// The app waits 1.5s before a hover tooltip; a specimen should answer at once.
	tooltip: Tooltip.init("kit-tooltip", 200),
	tooltipInverse: Tooltip.init("kit-tooltip-inverse", 200),
	menu: Menu.init({ id: "kit-menu" }),
	sortMenu: Menu.init({ id: "kit-sort", selectionMode: "Single", selectedKeys: ["recent"] }),
	contextMenu: Menu.init({ id: "kit-context", anchor: "Pointer" }),
	command: CommandMenu.init({ id: "kit-command", sections: COMMAND_SECTIONS }),
	toaster: Toaster.init(),
	lastEvent: "",
})

// MESSAGE

export const Message = defineMessageUnion({
	PressedAction: { label: Schema.String },
	ToggledChip: { key: Schema.String },
	ChangedText: { field: TextField, value: Schema.String },
	ToggledCheck: { key: Schema.String, isSelected: Schema.Boolean },
	ToggledSwitch: { key: Schema.String, isSelected: Schema.Boolean },
	ChoseNotify: { value: Schema.String },
	ChoseRouteTab: { key: Schema.String },
	PressedOpenDialog: { dialog: Dialog },
	PressedOpenCommand: {},
	PressedShowToast: { kind: ToastKind },
	GotRoleMessage: { message: Select.Message },
	GotChannelMessage: { message: ComboBox.Message },
	GotDueDateMessage: { message: DatePicker.Message },
	GotStartDateMessage: { message: Segments.Message },
	GotReminderMessage: { message: Segments.Message },
	GotVolumeSliderMessage: { message: Slider.Message },
	GotPlanMessage: { message: ChoiceBox.Message },
	GotAddonsMessage: { message: ChoiceBox.Message },
	GotCalendarMessage: { message: Calendar.Message },
	GotTabsMessage: { message: Tabs.Message },
	GotToolbarMessage: { message: Toolbar.Message },
	GotModalMessage: { message: Modal.Message },
	GotAlertMessage: { message: Modal.Message },
	GotSheetMessage: { message: Modal.Message },
	GotPopoverMessage: { message: Popover.Message },
	GotTooltipMessage: { message: Tooltip.Message },
	GotTooltipInverseMessage: { message: Tooltip.Message },
	GotMenuMessage: { message: Menu.Message },
	GotSortMenuMessage: { message: Menu.Message },
	GotContextMenuMessage: { message: Menu.Message },
	GotCommandMessage: { message: CommandMenu.Message },
	GotToasterMessage: { message: Toaster.Message },
})
export type Message = typeof Message.Type
