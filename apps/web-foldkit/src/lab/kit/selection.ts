import type { Html, HtmlBuilder } from "foldkit/html"
import type * as Calendar from "../../ui/calendar"
import { view as calendarView } from "../../ui/calendar-view"
import { checkbox } from "../../ui/checkbox"
import { type ChoiceBoxItem, choiceBox } from "../../ui/choice-box"
import * as Field from "../../ui/field"
import { radioGroup } from "../../ui/radio"
import * as Slider from "../../ui/slider"
import { switchControl } from "../../ui/switch"
import { kitSection, pair, specimen } from "./chrome"
import { Message, type Model } from "./model"

type H = HtmlBuilder<Message>

const STAGE = "flex-col items-stretch gap-4"

const percent = (value: number) => `${Math.round(value * 100)}%`

/** A label with a line under it, for a checkbox, radio or switch that needs explaining. */
const described = (h: H, label: string, description: string): Array<Html> => [
	Field.label(h, { elementType: "span" }, [label]),
	Field.description(h, {}, [description]),
]

const PLANS: ReadonlyArray<ChoiceBoxItem> = [
	{ key: "free", label: "Free", description: "Up to 10 people, 90 days of history." },
	{ key: "pro", label: "Pro", description: "Unlimited history, guests and integrations." },
	{ key: "enterprise", label: "Enterprise", description: "SSO, audit log and a named contact." },
]

const ADDONS: ReadonlyArray<ChoiceBoxItem> = [
	{ key: "sso", label: "Single sign-on", description: "SAML and SCIM." },
	{ key: "audit", label: "Audit log", description: "Every admin action." },
	{ key: "residency", label: "Data residency", description: "EU only.", isDisabled: true },
]

const checkboxes = (h: H, model: Model): Html => {
	const check = (key: string) => ({
		id: `kit-check-${key}`,
		isSelected: model.checked.includes(key),
		onChange: (isSelected: boolean) => Message.ToggledCheck({ key, isSelected }),
	})
	return specimen(
		h,
		{
			name: "Checkbox",
			file: "ui/checkbox.ts",
			note: "Several of a set, or one yes-or-no that waits for a Save.",
			className: STAGE,
		},
		[
			checkbox(h, check("mentions"), "Mentions"),
			checkbox(h, check("threads"), described(h, "Thread replies", "Replies in threads you follow.")),
			checkbox(h, { id: "kit-check-some", isSelected: false, isIndeterminate: true }, "Some channels"),
			checkbox(h, { id: "kit-check-invalid", isSelected: false, isInvalid: true }, "Accept the terms"),
			checkbox(
				h,
				{ id: "kit-check-disabled", isSelected: true, isDisabled: true },
				"Required by admin",
			),
		],
	)
}

const radios = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Radio group",
			file: "ui/radio.ts",
			note: "Exactly one of a few, all visible at once. Arrow keys move the choice.",
			className: STAGE,
		},
		[
			radioGroup(
				h,
				{
					id: "kit-notify",
					value: model.notify,
					onChange: (value) => Message.ChoseNotify({ value }),
				},
				(parts) => [
					parts.label(["Notify me about"]),
					parts.radio("all", described(h, "All messages", "Every message in every channel.")),
					parts.radio("mentions", described(h, "Mentions", "Only when someone names you.")),
					parts.radio("none", described(h, "Nothing", "You will still see unread counts.")),
				],
			),
		],
	)

const switches = (h: H, model: Model): Html => {
	const toggle = (key: string) => ({
		id: `kit-switch-${key}`,
		isSelected: model.switches.includes(key),
		onChange: (isSelected: boolean) => Message.ToggledSwitch({ key, isSelected }),
	})
	return specimen(
		h,
		{
			name: "Switch",
			file: "ui/switch.ts",
			note: "A setting that takes effect the moment it flips.",
			className: STAGE,
		},
		[
			switchControl(h, toggle("sounds"), "Notification sounds"),
			switchControl(
				h,
				toggle("compact"),
				described(h, "Compact messages", "Hide avatars and tighten the spacing."),
			),
			switchControl(
				h,
				{ id: "kit-switch-locked", isSelected: true, isDisabled: true },
				"Enforced by admin",
			),
		],
	)
}

const sliders = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Slider",
			file: "ui/slider.ts",
			note: "A value on a range where the exact number matters less than the feel.",
			className: STAGE,
		},
		[
			h.submodel({
				slotId: model.volumeSlider.id,
				model: model.volumeSlider,
				view: Slider.view,
				viewInputs: {
					value: model.volume,
					formatValue: percent,
					toView: (attributes) =>
						Slider.layout(h, attributes, { label: "Volume", valueText: percent(model.volume) }),
				},
				toParentMessage: (message) => Message.GotVolumeSliderMessage({ message }),
			}),
		],
	)

const choices = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Choice box",
			file: "ui/choice-box.ts",
			note: "A radio or checkbox whose options need a line each. Stacked for one, a grid for several.",
			className: "flex-col items-stretch gap-6",
		},
		[
			h.div(
				[],
				choiceBox(
					h,
					{
						model: model.plan,
						toParentMessage: (message) => Message.GotPlanMessage({ message }),
						ariaLabel: "Plan",
					},
					PLANS,
				),
			),
			h.div(
				[],
				choiceBox(
					h,
					{
						model: model.addons,
						toParentMessage: (message) => Message.GotAddonsMessage({ message }),
						ariaLabel: "Add-ons",
						columns: 3,
						gap: 3,
					},
					ADDONS,
				),
			),
		],
	)

const calendars = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Calendar",
			file: "ui/calendar.ts",
			note: "A month to pick a day from. Today carries a dot, the choice a fill.",
			className: "justify-center",
		},
		[
			h.submodel({
				slotId: model.calendar.id,
				model: model.calendar,
				view: calendarView,
				viewInputs: { ariaLabel: "Event date" },
				toParentMessage: (message: Calendar.Message) => Message.GotCalendarMessage({ message }),
			}),
		],
	)

export const selection = (h: H, model: Model): Html =>
	kitSection(h, "selection", [
		pair(h, [checkboxes(h, model), radios(h, model)]),
		pair(h, [
			h.div([h.Class("flex flex-col gap-8")], [switches(h, model), sliders(h, model)]),
			calendars(h, model),
		]),
		choices(h, model),
	])
