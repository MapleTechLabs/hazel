import { Option, Schema } from "effect"
import { Subscription, Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Calendar from "../../ui/calendar"
import * as D from "../../ui/calendar-date"
import { view as calendarView } from "../../ui/calendar-view"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Slot = Schema.Literals(["event", "deadline"])
type Slot = typeof Slot.Type

const Model = Schema.Struct({ event: Calendar.Model, deadline: Calendar.Model })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotCalendarMessage: { slotId: Slot, message: Calendar.Message },
})
type Message = typeof Message.Type

const toMessage = (slot: Slot) => (message: Calendar.Message) =>
	Message.GotCalendarMessage({ slotId: slot, message })

// UPDATE

const fold = (slot: Slot) =>
	Update.foldChild({
		update: Calendar.update,
		read: (model: Model) => Option.some(model[slot]),
		write: (model: Model, next: Calendar.Model): Model => ({ ...model, [slot]: next }),
		toParentMessage: toMessage(slot),
		foldOutMessage: () => (model: Model) => ({ model }),
	})

const lift = (slot: Slot) =>
	Subscription.lift(Calendar.subscriptions)<Model, Message>({
		read: (model) => Option.some(model[slot]),
		toParentMessage: toMessage(slot),
	})

const subscriptions = Subscription.aggregate<Model, Message>()(lift("event"), {
	deadlineModality: lift("deadline").modality,
	deadlinePointerRelease: lift("deadline").pointerRelease,
})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const calendar = (slot: Slot, ariaLabel: string) =>
		h.submodel({
			slotId: slot,
			model: model[slot],
			view: calendarView,
			viewInputs: { ariaLabel },
			toParentMessage: toMessage(slot),
		})
	return galleryFrame(h, "Calendar", [
		gallerySection(h, "Selected date", [calendar("event", "Event date")]),
		gallerySection(h, "Minimum date", [calendar("deadline", "Deadline")]),
	])
}

export const gallery = defineGallery<Model, Message>("Calendar", {
	Model,
	init: () => {
		const today = D.today()
		return {
			model: {
				event: Calendar.init({ id: "event", today, value: "2026-03-18" }),
				deadline: Calendar.init({ id: "deadline", today, minValue: "2026-03-10" }),
			},
		}
	},
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotCalendarMessage: ({ slotId: slot, message }) => fold(slot)(model, message),
		}),
	subscriptions,
	view,
})
