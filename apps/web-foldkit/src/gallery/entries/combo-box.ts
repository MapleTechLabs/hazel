import { Array, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { isAppleDevice } from "../../ui/aria/announcer"
import * as ComboBox from "../../ui/combo-box"
import { view as comboBoxView } from "../../ui/combo-box-view"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Struct({ comboBoxes: Schema.Array(ComboBox.Model) })
type Model = typeof Model.Type

const channels = [
	ComboBox.item("general", "General"),
	ComboBox.item("design", "Design"),
	ComboBox.item("engineering", "Engineering"),
	ComboBox.item("random", "Random"),
	ComboBox.item("product", "Product updates"),
]

const labels: Readonly<Record<string, string>> = { channel: "Channel", selected: "Selected" }

// MESSAGE

const Message = defineMessageUnion({
	GotComboBoxMessage: { id: Schema.String, message: ComboBox.Message },
})
type Message = typeof Message.Type

// UPDATE

const foldComboBoxOutMessage = ComboBox.OutMessage.match<Update.Step<Model, Message>>({
	ChangedSelection: () => (model) => ({ model }),
})

const foldComboBox = (id: string) =>
	Update.foldChild({
		update: ComboBox.update,
		read: (model: Model) => Array.findFirst(model.comboBoxes, (comboBox) => comboBox.id === id),
		write: (model, nextComboBox) =>
			modifyFields(model, {
				comboBoxes: Array.map((comboBox) => (comboBox.id === id ? nextComboBox : comboBox)),
			}),
		toParentMessage: (message) => Message.GotComboBoxMessage({ id, message }),
		foldOutMessage: foldComboBoxOutMessage,
	})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Combo box", [
		gallerySection(
			h,
			"Combo box",
			Array.map(model.comboBoxes, (comboBox) =>
				h.submodel({
					slotId: comboBox.id,
					model: comboBox,
					view: comboBoxView,
					viewInputs: {
						label: labels[comboBox.id] ?? "",
						placeholder: "Search channels",
						className: "w-64",
					},
					toParentMessage: (message) => Message.GotComboBoxMessage({ id: comboBox.id, message }),
				}),
			),
		),
	])

export const gallery = defineGallery<Model, Message>("Combo box", {
	Model,
	init: () => ({
		model: {
			comboBoxes: [
				ComboBox.init({ id: "channel", items: channels, isAppleDevice: isAppleDevice() }),
				ComboBox.init({
					id: "selected",
					items: channels,
					selectedKey: "design",
					isAppleDevice: isAppleDevice(),
				}),
			],
		},
	}),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotComboBoxMessage: ({ id, message }) => foldComboBox(id)(model, message),
		}),
	view,
})
