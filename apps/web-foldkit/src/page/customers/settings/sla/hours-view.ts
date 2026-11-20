import type { Html, HtmlBuilder } from "foldkit/html"
import { button } from "../../../../ui/button"
import { input } from "../../../../ui/input"
import * as Select from "../../../../ui/select"
import { toggleChip } from "../../../../ui/toggle-chip"
import { hoursErrors, sameHours, WEEKDAYS } from "./draft"
import { Message } from "./message"
import { COMMON_TIME_ZONES, hoursFormOf, type Model, TIME_ZONE_SELECT_ID } from "./model"
import { card, errorText, field, fieldLabel, help, selectField } from "./parts"

/** The org's working week: time zone, days, start and end. */

type H = HtmlBuilder<Message>

const START_ID = "sla-hours-start"
const END_ID = "sla-hours-end"
const DAYS_ERROR_ID = "sla-hours-days-error"
const TIME_ERROR_ID = "sla-hours-time-error"

const zoneLabel = (zone: string) => zone.replaceAll("_", " ")

const timeInput = (
	h: H,
	options: Readonly<{
		id: string
		label: string
		value: string
		isInvalid: boolean
		isDisabled: boolean
		onInput: (value: string) => Message
	}>,
): Html =>
	input(h, {
		className: "w-32 tabular-nums",
		isInvalid: options.isInvalid,
		isDisabled: options.isDisabled,
		attributes: [
			h.Id(options.id),
			h.Type("time"),
			h.AriaLabel(options.label),
			h.Value(options.value),
			h.OnInput(options.onInput),
			...(options.isInvalid ? [h.AriaDescribedBy(TIME_ERROR_ID)] : []),
		],
	})

export const hoursCard = (h: H, model: Model, canEdit: boolean): Html => {
	const form = hoursFormOf(model)
	const errors = model.hoursForm === null ? { days: undefined, time: undefined } : hoursErrors(form)
	const zones = COMMON_TIME_ZONES.includes(form.timeZone)
		? COMMON_TIME_ZONES
		: [form.timeZone, ...COMMON_TIME_ZONES]
	const saved = model.settings?.businessHours
	const isDirty = model.hoursForm !== null && (saved === undefined || !sameHours(model.hoursForm, saved))
	const isDisabled = !canEdit || model.isSavingHours
	const hasErrors = errors.days !== undefined || errors.time !== undefined
	return card(
		h,
		{
			title: "Business hours",
			description: "Policies on business hours count only this working week. No holidays yet.",
		},
		[
			h.div(
				[h.Class("grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto]")],
				[
					field(h, [
						fieldLabel(h, "Time zone"),
						selectField(h, model, {
							id: TIME_ZONE_SELECT_ID,
							items: zones.map((zone) => Select.item(zone, zoneLabel(zone))),
							ariaLabel: "Time zone",
							triggerClassName: "w-full",
						}),
					]),
					field(h, [
						fieldLabel(h, "Working days"),
						h.div(
							[h.Role("group"), h.AriaLabel("Working days"), h.Class("flex flex-wrap gap-1.5")],
							WEEKDAYS.map(([day, short, long]) =>
								toggleChip(h, {
									label: short,
									ariaLabel: long,
									isPressed: form.days.includes(day),
									isDisabled,
									onPress: Message.ToggledDay({ day }),
									className: "min-w-12",
								}),
							),
						),
						...errorText(h, DAYS_ERROR_ID, errors.days),
					]),
					field(h, [
						fieldLabel(h, "Hours", START_ID),
						h.div(
							[h.Class("flex items-center gap-2")],
							[
								timeInput(h, {
									id: START_ID,
									label: "Start",
									value: form.start,
									isInvalid: errors.time !== undefined,
									isDisabled,
									onInput: (value) => Message.ChangedStart({ value }),
								}),
								h.span([h.AriaHidden(true), h.Class("text-muted-fg text-sm")], ["–"]),
								timeInput(h, {
									id: END_ID,
									label: "End",
									value: form.end,
									isInvalid: errors.time !== undefined,
									isDisabled,
									onInput: (value) => Message.ChangedEnd({ value }),
								}),
							],
						),
						...errorText(h, TIME_ERROR_ID, errors.time),
					]),
				],
			),
			...(canEdit && model.hoursForm !== null
				? [
						h.div(
							[h.Class("flex flex-wrap items-center justify-end gap-2")],
							[
								...(isDirty ? [] : [help(h, "No changes")]),
								button(
									h,
									{
										intent: "plain",
										size: "sm",
										isDisabled: model.isSavingHours,
										onPress: Message.PressedResetHours(),
									},
									["Reset"],
								),
								button(
									h,
									{
										size: "sm",
										onPress: Message.PressedSaveHours(),
										isDisabled: !isDirty || hasErrors || model.settings === null,
										isPending: model.isSavingHours,
									},
									["Save hours"],
								),
							],
						),
					]
				: []),
		],
	)
}
