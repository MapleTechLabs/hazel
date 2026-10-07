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

const Model = Schema.Struct({ trip: Calendar.Model })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotTripMessage: { message: Calendar.Message },
})
type Message = typeof Message.Type

const toTripMessage = (message: Calendar.Message) => Message.GotTripMessage({ message })

// UPDATE

const foldTrip = Update.foldChild({
	update: Calendar.update,
	read: (model: Model) => Option.some(model.trip),
	write: (_model: Model, trip: Calendar.Model): Model => ({ trip }),
	toParentMessage: toTripMessage,
	foldOutMessage: () => (model: Model) => ({ model }),
})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "RangeCalendar", [
		gallerySection(h, "Selected range", [
			h.submodel({
				slotId: "trip",
				model: model.trip,
				view: calendarView,
				viewInputs: { ariaLabel: "Trip dates" },
				toParentMessage: toTripMessage,
			}),
		]),
	])

export const gallery = defineGallery<Model, Message>("RangeCalendar", {
	Model,
	init: () => ({
		model: {
			trip: Calendar.init({
				id: "trip",
				mode: "Range",
				today: D.today(),
				range: { start: "2026-03-09", end: "2026-03-13" },
			}),
		},
	}),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotTripMessage: ({ message }) => foldTrip(model, message),
		}),
	subscriptions: Subscription.lift(Calendar.subscriptions)<Model, Message>({
		read: (model) => Option.some(model.trip),
		toParentMessage: toTripMessage,
	}),
	view,
})
