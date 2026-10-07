import { Array, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as ComboBox from "../../ui/combo-box"
import * as TimezoneSelect from "../../ui/timezone-select"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Struct({ zones: Schema.Array(ComboBox.Model) })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotZoneMessage: { id: Schema.String, message: ComboBox.Message },
})
type Message = typeof Message.Type

// UPDATE

const foldZoneOutMessage = ComboBox.OutMessage.match<Update.Step<Model, Message>>({
	ChangedSelection: () => (model) => ({ model }),
})

const foldZone = (id: string) =>
	Update.foldChild({
		update: ComboBox.update,
		read: (model: Model) => Array.findFirst(model.zones, (zone) => zone.id === id),
		write: (model, nextZone) =>
			modifyFields(model, { zones: Array.map((zone) => (zone.id === id ? nextZone : zone)) }),
		toParentMessage: (message) => Message.GotZoneMessage({ id, message }),
		foldOutMessage: foldZoneOutMessage,
	})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Timezone select", [
		gallerySection(
			h,
			"Timezone select",
			Array.map(model.zones, (zone) =>
				h.submodel({
					slotId: zone.id,
					model: zone,
					view: TimezoneSelect.view,
					viewInputs: TimezoneSelect.viewInputs({ className: "w-72" }),
					toParentMessage: (message) => Message.GotZoneMessage({ id: zone.id, message }),
				}),
			),
		),
	])

export const gallery = defineGallery<Model, Message>("Timezone select", {
	Model,
	init: () => ({
		model: {
			zones: [
				TimezoneSelect.init({ id: "berlin", value: "Europe/Berlin" }),
				TimezoneSelect.init({ id: "empty" }),
			],
		},
	}),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotZoneMessage: ({ id, message }) => foldZone(id)(model, message),
		}),
	view,
})
