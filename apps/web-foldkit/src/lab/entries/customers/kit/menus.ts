import { Schema } from "effect"
import { Command, type Update } from "foldkit"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { IconClock, IconDots } from "../../../../icons"
import * as Menu from "../../../../ui/menu"
import { view as menuView } from "../../../../ui/menu-view"
import { formatDateTime } from "../../../../customers/format"
import {
	rowActionsContent,
	rowActionsEntries,
	snoozeInstantOf,
	snoozeMenuContent,
	snoozeMenuEntries,
} from "../../../../customers/ui/menus"
import { queueAction } from "../../../../customers/ui/queue-row"
import { defineLab } from "../../../define"
import { labPage, labSection } from "../../../frame"
import { NOW } from "../../../fixtures/customers"

// `/lab/customers/kit/menus`: Foundations › Menus Snooze And Row Actions, on the app's Menu.

const Model = Schema.Struct({ snooze: Menu.Model, row: Menu.Model, last: Schema.String })
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotSnoozeMenuMessage: { message: Menu.Message },
	GotRowMenuMessage: { message: Menu.Message },
})
type Message = typeof Message.Type

type Return = Update.Return<Model, Message, never>

/** What the page would do with a picked key: here, say it. */
const picked = (key: string): string => {
	const until = snoozeInstantOf(key, NOW)
	return until === null ? `Picked "${key}"` : `Snoozed until ${formatDateTime(until)}`
}

const fold = (
	model: Model,
	field: "snooze" | "row",
	message: Menu.Message,
	wrap: (message: Menu.Message) => Message,
): Return => {
	const next = Menu.update(model[field], message)
	const commands = Command.mapMessages(next.commands ?? [], wrap)
	const out = next.outMessage
	return {
		model: {
			...model,
			[field]: next.model,
			last: out?._tag === "SelectedItem" ? picked(out.key) : model.last,
		},
		commands,
	}
}

const update = (model: Model, message: Message): Return =>
	Message.match(message, {
		GotSnoozeMenuMessage: ({ message: child }) =>
			fold(model, "snooze", child, (inner) => Message.GotSnoozeMenuMessage({ message: inner })),
		GotRowMenuMessage: ({ message: child }) =>
			fold(model, "row", child, (inner) => Message.GotRowMenuMessage({ message: inner })),
	})

const view = (model: Model, h: HtmlBuilder<Message>): Html =>
	labPage(h, { title: "Menus" }, [
		labSection(h, "Snooze · row actions (open them)", [
			h.div(
				[h.Class("flex items-center gap-6")],
				[
					h.submodel({
						slotId: model.snooze.id,
						model: model.snooze,
						view: menuView,
						viewInputs: {
							entries: snoozeMenuEntries,
							content: snoozeMenuContent(h, model.snooze.id, NOW),
							toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) =>
								queueAction(h, { label: "Snooze", icon: IconClock(h), attributes, overlay }),
						},
						toParentMessage: (message: Menu.Message) => Message.GotSnoozeMenuMessage({ message }),
					}),
					h.submodel({
						slotId: model.row.id,
						model: model.row,
						view: menuView,
						viewInputs: {
							entries: rowActionsEntries({ championEmail: true }),
							content: rowActionsContent(h, model.row.id, NOW),
							toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) =>
								queueAction(h, {
									label: "Row actions",
									icon: IconDots(h),
									iconOnly: true,
									attributes,
									overlay,
								}),
						},
						toParentMessage: (message: Menu.Message) => Message.GotRowMenuMessage({ message }),
					}),
					h.span([h.Class("text-muted-fg text-sm"), h.AriaLive("polite")], [model.last]),
				],
			),
		]),
	])

export const lab = defineLab("Menus", {
	Model,
	init: () => ({
		model: {
			snooze: Menu.init({ id: "lab-snooze" }),
			row: Menu.init({ id: "lab-row-actions", placement: "bottom end" }),
			last: "",
		},
	}),
	update,
	view,
})
