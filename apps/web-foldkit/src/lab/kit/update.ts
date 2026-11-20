import { Match, Option, Record } from "effect"
import { Subscription, Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
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
import * as Toolbar from "../../ui/toolbar"
import * as Tooltip from "../../ui/tooltip"
import { CHANNEL_ITEMS, type Dialog, Message, type Model, SettingsTabs, type ToastKind } from "./model"

type Return = Update.Return<Model, Message>
type Step = Update.Step<Model, Message>

/** Records what a specimen reported, so the page shows it is live. */
const logged =
	(text: string): Step =>
	(model) => ({ model: modifyFields(model, { lastEvent: () => text }) })

const toggled = (keys: ReadonlyArray<string>, key: string, isOn: boolean): ReadonlyArray<string> =>
	isOn ? [...keys.filter((current) => current !== key), key] : keys.filter((current) => current !== key)

// FIELDS

const foldRole = Update.foldChild({
	update: Select.update,
	read: (model: Model) => Option.some(model.role),
	write: (model, role) => modifyFields(model, { role: () => role }),
	toParentMessage: (message: Select.Message) => Message.GotRoleMessage({ message }),
	foldOutMessage: (out: Select.OutMessage) => logged(`Select chose "${out.key}"`),
})

const foldChannel = Update.foldChild({
	update: (channel: ComboBox.Model, message: ComboBox.Message) =>
		ComboBox.update(channel, message, CHANNEL_ITEMS),
	read: (model: Model) => Option.some(model.channel),
	write: (model, channel) => modifyFields(model, { channel: () => channel }),
	toParentMessage: (message: ComboBox.Message) => Message.GotChannelMessage({ message }),
	foldOutMessage: (out: ComboBox.OutMessage) => logged(`Combo box chose "${out.key}"`),
})

const foldDueDate = Update.foldChild({
	update: DatePicker.update,
	read: (model: Model) => Option.some(model.dueDate),
	write: (model, dueDate) => modifyFields(model, { dueDate: () => dueDate }),
	toParentMessage: (message: DatePicker.Message) => Message.GotDueDateMessage({ message }),
	foldOutMessage: (out: DatePicker.OutMessage) => logged(`Date picker chose ${out.date}`),
})

const foldStartDate = Update.foldChild({
	update: Segments.update,
	read: (model: Model) => Option.some(model.startDate),
	write: (model, startDate) => modifyFields(model, { startDate: () => startDate }),
	toParentMessage: (message: Segments.Message) => Message.GotStartDateMessage({ message }),
})

const foldReminder = Update.foldChild({
	update: Segments.update,
	read: (model: Model) => Option.some(model.reminder),
	write: (model, reminder) => modifyFields(model, { reminder: () => reminder }),
	toParentMessage: (message: Segments.Message) => Message.GotReminderMessage({ message }),
})

// SELECTION

const foldVolumeSlider = Update.foldChild({
	update: Slider.update,
	read: (model: Model) => Option.some(model.volumeSlider),
	write: (model, volumeSlider) => modifyFields(model, { volumeSlider: () => volumeSlider }),
	toParentMessage: (message: Slider.Message) => Message.GotVolumeSliderMessage({ message }),
	foldOutMessage:
		(out: Slider.OutMessage): Step =>
		(model) => ({ model: modifyFields(model, { volume: () => out.value }) }),
})

const foldPlan = Update.foldChild({
	update: ChoiceBox.update,
	read: (model: Model) => Option.some(model.plan),
	write: (model, plan) => modifyFields(model, { plan: () => plan }),
	toParentMessage: (message: ChoiceBox.Message) => Message.GotPlanMessage({ message }),
})

const foldAddons = Update.foldChild({
	update: ChoiceBox.update,
	read: (model: Model) => Option.some(model.addons),
	write: (model, addons) => modifyFields(model, { addons: () => addons }),
	toParentMessage: (message: ChoiceBox.Message) => Message.GotAddonsMessage({ message }),
})

const foldCalendar = Update.foldChild({
	update: Calendar.update,
	read: (model: Model) => Option.some(model.calendar),
	write: (model, calendar) => modifyFields(model, { calendar: () => calendar }),
	toParentMessage: (message: Calendar.Message) => Message.GotCalendarMessage({ message }),
	foldOutMessage: (out: Calendar.OutMessage) => logged(`Calendar chose ${out.date}`),
})

// NAVIGATION

const foldTabs = Update.foldChild({
	update: SettingsTabs.update,
	read: (model: Model) => Option.some(model.tabs),
	write: (model, tabs) => modifyFields(model, { tabs: () => tabs }),
	toParentMessage: (message: Parameters<typeof SettingsTabs.update>[1]) =>
		Message.GotTabsMessage({ message }),
	foldOutMessage:
		(out: NonNullable<ReturnType<typeof SettingsTabs.update>["outMessage"]>): Step =>
		(model) => ({ model: modifyFields(model, { tab: () => out.value }) }),
})

const foldToolbar = Update.foldChild({
	update: Toolbar.update,
	read: (model: Model) => Option.some(model.toolbar),
	write: (model, toolbar) => modifyFields(model, { toolbar: () => toolbar }),
	toParentMessage: (message: Toolbar.Message) => Message.GotToolbarMessage({ message }),
})

// OVERLAYS

type DialogStep = (dialog: Modal.Model) => ReturnType<typeof Modal.update>

/** A dialog's fold takes the step to run (`Modal.open`, or its own `update` on a Message). */
const foldModal = Update.foldChild({
	update: (dialog: Modal.Model, step: DialogStep) => step(dialog),
	read: (model: Model) => Option.some(model.modal),
	write: (model, modal) => modifyFields(model, { modal: () => modal }),
	toParentMessage: (message: Modal.Message) => Message.GotModalMessage({ message }),
	foldOutMessage: Modal.ignoreOutMessage,
})

const foldAlert = Update.foldChild({
	update: (dialog: Modal.Model, step: DialogStep) => step(dialog),
	read: (model: Model) => Option.some(model.alert),
	write: (model, alert) => modifyFields(model, { alert: () => alert }),
	toParentMessage: (message: Modal.Message) => Message.GotAlertMessage({ message }),
	foldOutMessage: Modal.ignoreOutMessage,
})

const foldSheet = Update.foldChild({
	update: (dialog: Modal.Model, step: DialogStep) => step(dialog),
	read: (model: Model) => Option.some(model.sheet),
	write: (model, sheet) => modifyFields(model, { sheet: () => sheet }),
	toParentMessage: (message: Modal.Message) => Message.GotSheetMessage({ message }),
	foldOutMessage: Modal.ignoreOutMessage,
})

const openDialog = (model: Model, dialog: Dialog): Return =>
	Match.value(dialog).pipe(
		Match.withReturnType<Return>(),
		Match.when("modal", () => foldModal(model, Modal.open)),
		Match.when("alert", () => foldAlert(model, Modal.open)),
		Match.when("sheet", () => foldSheet(model, Modal.open)),
		Match.exhaustive,
	)

const foldPopover = Update.foldChild({
	update: Popover.update,
	read: (model: Model) => Option.some(model.popover),
	write: (model, popover) => modifyFields(model, { popover: () => popover }),
	toParentMessage: (message: Popover.Message) => Message.GotPopoverMessage({ message }),
	foldOutMessage:
		(_out: Popover.OutMessage): Step =>
		(model) => ({ model }),
})

const foldTooltip = Update.foldChild({
	update: Tooltip.update,
	read: (model: Model) => Option.some(model.tooltip),
	write: (model, tooltip) => modifyFields(model, { tooltip: () => tooltip }),
	toParentMessage: (message: Tooltip.Message) => Message.GotTooltipMessage({ message }),
	foldOutMessage:
		(_out: Tooltip.OutMessage): Step =>
		(model) => ({ model }),
})

const foldTooltipInverse = Update.foldChild({
	update: Tooltip.update,
	read: (model: Model) => Option.some(model.tooltipInverse),
	write: (model, tooltipInverse) => modifyFields(model, { tooltipInverse: () => tooltipInverse }),
	toParentMessage: (message: Tooltip.Message) => Message.GotTooltipInverseMessage({ message }),
	foldOutMessage:
		(_out: Tooltip.OutMessage): Step =>
		(model) => ({ model }),
})

const menuPicked = (name: string) => (out: Menu.OutMessage) => logged(`${name} chose "${out.key}"`)

const foldMenu = Update.foldChild({
	update: Menu.update,
	read: (model: Model) => Option.some(model.menu),
	write: (model, menu) => modifyFields(model, { menu: () => menu }),
	toParentMessage: (message: Menu.Message) => Message.GotMenuMessage({ message }),
	foldOutMessage: menuPicked("Menu"),
})

const foldSortMenu = Update.foldChild({
	update: Menu.update,
	read: (model: Model) => Option.some(model.sortMenu),
	write: (model, sortMenu) => modifyFields(model, { sortMenu: () => sortMenu }),
	toParentMessage: (message: Menu.Message) => Message.GotSortMenuMessage({ message }),
	foldOutMessage: menuPicked("Sort menu"),
})

const foldContextMenu = Update.foldChild({
	update: Menu.update,
	read: (model: Model) => Option.some(model.contextMenu),
	write: (model, contextMenu) => modifyFields(model, { contextMenu: () => contextMenu }),
	toParentMessage: (message: Menu.Message) => Message.GotContextMenuMessage({ message }),
	foldOutMessage: menuPicked("Context menu"),
})

type CommandStep = (command: CommandMenu.Model) => ReturnType<typeof CommandMenu.update>

const foldCommand = Update.foldChild({
	update: (command: CommandMenu.Model, step: CommandStep) => step(command),
	read: (model: Model) => Option.some(model.command),
	write: (model, command) => modifyFields(model, { command: () => command }),
	toParentMessage: (message: CommandMenu.Message) => Message.GotCommandMessage({ message }),
	foldOutMessage: CommandMenu.OutMessage.match<Step>({
		SelectedItem: ({ key }) => logged(`Command menu ran "${key}"`),
		Closed: () => (model) => ({ model }),
	}),
})

type ToasterStep = (toaster: Toaster.Model) => Update.Return<Toaster.Model, Toaster.Message>

const foldToaster = Update.foldChild({
	update: (toaster: Toaster.Model, step: ToasterStep) => step(toaster),
	read: (model: Model) => Option.some(model.toaster),
	write: (model, toaster) => modifyFields(model, { toaster: () => toaster }),
	toParentMessage: (message: Toaster.Message) => Message.GotToasterMessage({ message }),
})

/** One toast per kind; the info one carries an action, so it stays until dismissed. */
const TOASTS = {
	success: { title: "Invitation sent", description: "ada@hazel.sh will get an email." },
	error: { title: "Could not save changes", description: "The server did not answer. Try again." },
	info: {
		title: "A new version is ready",
		description: "Restart Hazel to update.",
		action: { label: "Restart", key: "InstallUpdate" },
		isSticky: true,
	},
	warning: { title: "Connection is unstable", description: "Messages send when you are back online." },
	loading: { title: "Uploading 3 files…", description: null },
} as const satisfies Record<ToastKind, Omit<Toaster.ToastRequest, "intent">>

const showToast = (model: Model, kind: ToastKind): Return =>
	foldToaster(model, (toaster) => Toaster.push(toaster, { intent: kind, ...TOASTS[kind] }))

// UPDATE

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		PressedAction: ({ label }) => logged(`Pressed "${label}"`)(model),
		ToggledChip: ({ key }) => ({
			model: modifyFields(model, {
				pressedChips: (keys) => toggled(keys, key, !keys.includes(key)),
			}),
		}),
		ChangedText: ({ field, value }) => ({ model: { ...model, [field]: value } }),
		ToggledCheck: ({ key, isSelected }) => ({
			model: modifyFields(model, { checked: (keys) => toggled(keys, key, isSelected) }),
		}),
		ToggledSwitch: ({ key, isSelected }) => ({
			model: modifyFields(model, { switches: (keys) => toggled(keys, key, isSelected) }),
		}),
		ChoseNotify: ({ value }) => ({ model: modifyFields(model, { notify: () => value }) }),
		ChoseRouteTab: ({ key }) => ({ model: modifyFields(model, { routeTab: () => key }) }),
		PressedOpenDialog: ({ dialog }) => openDialog(model, dialog),
		PressedOpenCommand: () => foldCommand(model, CommandMenu.open),
		PressedShowToast: ({ kind }) => showToast(model, kind),
		GotRoleMessage: ({ message: child }) => foldRole(model, child),
		GotChannelMessage: ({ message: child }) => foldChannel(model, child),
		GotDueDateMessage: ({ message: child }) => foldDueDate(model, child),
		GotStartDateMessage: ({ message: child }) => foldStartDate(model, child),
		GotReminderMessage: ({ message: child }) => foldReminder(model, child),
		GotVolumeSliderMessage: ({ message: child }) => foldVolumeSlider(model, child),
		GotPlanMessage: ({ message: child }) => foldPlan(model, child),
		GotAddonsMessage: ({ message: child }) => foldAddons(model, child),
		GotCalendarMessage: ({ message: child }) => foldCalendar(model, child),
		GotTabsMessage: ({ message: child }) => foldTabs(model, child),
		GotToolbarMessage: ({ message: child }) => foldToolbar(model, child),
		GotModalMessage: ({ message: child }) => foldModal(model, (dialog) => Modal.update(dialog, child)),
		GotAlertMessage: ({ message: child }) => foldAlert(model, (dialog) => Modal.update(dialog, child)),
		GotSheetMessage: ({ message: child }) => foldSheet(model, (dialog) => Modal.update(dialog, child)),
		GotPopoverMessage: ({ message: child }) => foldPopover(model, child),
		GotTooltipMessage: ({ message: child }) => foldTooltip(model, child),
		GotTooltipInverseMessage: ({ message: child }) => foldTooltipInverse(model, child),
		GotMenuMessage: ({ message: child }) => foldMenu(model, child),
		GotSortMenuMessage: ({ message: child }) => foldSortMenu(model, child),
		GotContextMenuMessage: ({ message: child }) => foldContextMenu(model, child),
		GotCommandMessage: ({ message: child }) =>
			foldCommand(model, (command) => CommandMenu.update(command, child)),
		GotToasterMessage: ({ message: child }) =>
			foldToaster(model, (toaster) => Toaster.update(toaster, child)),
	})

// SUBSCRIPTION

const toasts = Subscription.lift(Toaster.subscriptions)<Model, Message>({
	read: (model) => Option.some(model.toaster),
	toParentMessage: (message) => Message.GotToasterMessage({ message }),
})

const volume = Subscription.lift(Slider.subscriptions)<Model, Message>({
	read: (model) => Option.some(model.volumeSlider),
	toParentMessage: (message) => Message.GotVolumeSliderMessage({ message }),
})

const calendar = Subscription.lift(Calendar.subscriptions)<Model, Message>({
	read: (model) => Option.some(model.calendar),
	toParentMessage: (message) => Message.GotCalendarMessage({ message }),
})

const dueDate = Subscription.lift(DatePicker.subscriptions)<Model, Message>({
	read: (model) => Option.some(model.dueDate),
	toParentMessage: (message) => Message.GotDueDateMessage({ message }),
})

/**
 * The calendar and the date picker's calendar each lift the same interaction Subscriptions, under
 * the same keys; `aggregate` refuses a duplicate, so each instance's keys carry its name.
 */
const named = (
	name: string,
	record: Subscription.Subscriptions<Model, Message>,
): Subscription.Subscriptions<Model, Message> => Record.mapKeys(record, (key) => `${name}:${key}`)

export const subscriptions = Subscription.aggregate<Model, Message>()(
	toasts,
	volume,
	named("calendar", calendar),
	named("dueDate", dueDate),
)
