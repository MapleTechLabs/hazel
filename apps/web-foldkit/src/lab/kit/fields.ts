import type { Html, HtmlBuilder } from "foldkit/html"
import { IconEnvelope, IconHashtag } from "../../icons"
import type * as ComboBox from "../../ui/combo-box"
import { view as comboBoxView } from "../../ui/combo-box-view"
import { dateField } from "../../ui/date-field"
import type * as DatePicker from "../../ui/date-picker"
import { datePickerHidden, view as datePickerView } from "../../ui/date-picker-view"
import { input, inputGroup } from "../../ui/input"
import { searchField } from "../../ui/search-field"
import type * as Select from "../../ui/select"
import { view as selectView } from "../../ui/select-view"
import { textField } from "../../ui/text-field"
import { kitSection, pair, specimen } from "./chrome"
import { CHANNEL_ITEMS, Message, type Model, ROLE_ITEMS, type TextField } from "./model"

type H = HtmlBuilder<Message>

const typed = (field: TextField) => (value: string) => Message.ChangedText({ field, value })

const isEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value)

const STAGE = "flex-col items-stretch gap-5"

const textFields = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Text field",
			file: "ui/text-field.ts",
			note: "A label, the input, and one line of help or the error that replaces it.",
			className: STAGE,
		},
		[
			textField(h, { id: "kit-name", value: model.name, onInput: typed("name") }, (parts) => [
				parts.label(["Display name"]),
				parts.input({ placeholder: "Your name" }),
				parts.description(["Shown next to your messages."]),
			]),
			textField(
				h,
				{
					id: "kit-email",
					value: model.email,
					onInput: typed("email"),
					isInvalid: !isEmail(model.email),
					isRequired: true,
				},
				(parts) => [
					parts.label(["Email"]),
					parts.input({ placeholder: "you@company.com" }),
					parts.fieldError(["Enter a full address, like ada@hazel.sh."]),
				],
			),
			textField(h, { id: "kit-workspace", value: "acme", isDisabled: true }, (parts) => [
				parts.label(["Workspace URL"]),
				parts.input({}),
				parts.description(["Ask an owner to change it."]),
			]),
		],
	)

const textareas = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Textarea",
			file: "ui/textarea.ts",
			note: "Grows with what is typed, from three lines.",
			className: STAGE,
		},
		[
			textField(h, { id: "kit-about", value: model.about, onInput: typed("about") }, (parts) => [
				parts.label(["About this channel"]),
				parts.textarea({ placeholder: "What is this channel for?" }),
				parts.description(["Shown under the channel name."]),
			]),
		],
	)

const groups = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Input group and search",
			file: "ui/input.ts · ui/search-field.ts",
			note: "An icon, text or a button inside the field's own fill. Search clears with Escape.",
			className: STAGE,
		},
		[
			inputGroup(h, {}, [IconEnvelope(h), input(h, { placeholder: "Invite by email" })]),
			inputGroup(h, {}, [IconHashtag(h), input(h, { placeholder: "channel-name" })]),
			searchField(
				h,
				{
					id: "kit-search",
					value: model.search,
					onInput: typed("search"),
					onClear: Message.ChangedText({ field: "search", value: "" }),
				},
				(parts) => [parts.searchInput({ placeholder: "Search messages" })],
			),
		],
	)

const pickers = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Select and combo box",
			file: "ui/select.ts · ui/combo-box.ts",
			note: "Select for a short fixed list. A combo box when the list is long enough to type into.",
			className: STAGE,
		},
		[
			h.submodel({
				slotId: model.role.id,
				model: model.role,
				view: selectView,
				viewInputs: { items: ROLE_ITEMS, label: "Role", placeholder: "Choose a role" },
				toParentMessage: (message: Select.Message) => Message.GotRoleMessage({ message }),
			}),
			h.submodel({
				slotId: model.channel.id,
				model: model.channel,
				view: comboBoxView,
				viewInputs: { items: CHANNEL_ITEMS, label: "Channel", placeholder: "Pick a channel" },
				toParentMessage: (message: ComboBox.Message) => Message.GotChannelMessage({ message }),
			}),
		],
	)

const dates = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Date and time",
			file: "ui/date-field.ts · ui/date-picker.ts",
			note: "Segments type and step with the arrow keys. The picker adds a calendar.",
			className: "items-start gap-6",
		},
		[
			h.div(
				[],
				dateField(
					h,
					{
						model: model.startDate,
						toParentMessage: (message) => Message.GotStartDateMessage({ message }),
					},
					(field) => [field.label(["Starts"]), field.dateInput()],
				),
			),
			h.div(
				[],
				dateField(
					h,
					{
						model: model.reminder,
						toParentMessage: (message) => Message.GotReminderMessage({ message }),
					},
					(field) => [field.label(["Remind at"]), field.dateInput()],
				),
			),
			h.div(
				[],
				[
					h.submodel({
						slotId: model.dueDate.id,
						model: model.dueDate,
						view: datePickerView,
						viewInputs: { label: "Due date" },
						toParentMessage: (message: DatePicker.Message) =>
							Message.GotDueDateMessage({ message }),
					}),
					...datePickerHidden(h, model.dueDate),
				],
			),
		],
	)

export const fields = (h: H, model: Model): Html =>
	kitSection(h, "fields", [
		pair(h, [
			textFields(h, model),
			h.div([h.Class("flex flex-col gap-8")], [textareas(h, model), groups(h, model)]),
		]),
		pair(h, [pickers(h, model), dates(h, model)]),
	])
