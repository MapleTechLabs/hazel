import { Option, Schema } from "effect"
import { Subscription, Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as D from "../../ui/calendar-date"
import * as DatePicker from "../../ui/date-picker"
import { datePickerHidden, view as datePickerView } from "../../ui/date-picker-view"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Slot = Schema.Literals(["status", "due"])
type Slot = typeof Slot.Type

const Model = Schema.Struct({ status: DatePicker.Model, due: DatePicker.Model })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotPickerMessage: { slot: Slot, message: DatePicker.Message },
})
type Message = typeof Message.Type

const toMessage = (slot: Slot) => (message: DatePicker.Message) => Message.GotPickerMessage({ slot, message })

// UPDATE

const fold = (slot: Slot) =>
	Update.foldChild({
		update: DatePicker.update,
		read: (model: Model) => Option.some(model[slot]),
		write: (model: Model, next: DatePicker.Model): Model => ({ ...model, [slot]: next }),
		toParentMessage: toMessage(slot),
		foldOutMessage: () => (model: Model) => ({ model }),
	})

const lift = (slot: Slot) =>
	Subscription.lift(DatePicker.subscriptions)<Model, Message>({
		read: (model) => Option.some(model[slot]),
		toParentMessage: toMessage(slot),
	})

const subscriptions = Subscription.aggregate<Model, Message>()(lift("status"), {
	dueModality: lift("due").modality,
	duePointerRelease: lift("due").pointerRelease,
})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const picker = (slot: Slot, viewInputs: { label?: string; ariaLabel?: string }) => [
		h.submodel({
			slotId: slot,
			model: model[slot],
			view: datePickerView,
			viewInputs: { ...viewInputs, className: "w-64" },
			toParentMessage: toMessage(slot),
		}),
		...datePickerHidden(h, model[slot]),
	]
	return galleryFrame(h, "DatePicker", [
		gallerySection(h, "With a value", picker("status", { ariaLabel: "Clear status after" })),
		gallerySection(h, "With a label, empty", picker("due", { label: "Due date" })),
	])
}

export const gallery = defineGallery<Model, Message>("DatePicker", {
	Model,
	init: () => {
		const today = D.today()
		return {
			model: {
				status: DatePicker.init({ id: "status", today, value: "2026-03-18" }),
				due: DatePicker.init({ id: "due", today }),
			},
		}
	},
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotPickerMessage: ({ slot, message }) => fold(slot)(model, message),
		}),
	subscriptions,
	view,
})
