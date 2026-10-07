import { Array, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as Select from "../../ui/select"
import { view as selectView } from "../../ui/select-view"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Struct({ selects: Schema.Array(Select.Model) })
type Model = typeof Model.Type

const options = [
	Select.item("never", "Don't clear"),
	Select.item("30m", "30 minutes"),
	Select.item("1h", "1 hour"),
	Select.item("today", "Today"),
	Select.item("week", "This week"),
]

const examples = [
	{ id: "clear-after", label: "Clear after", selectedKey: "1h" },
	{ id: "reminder", label: "Reminder", placeholder: "Choose a time" },
	{ id: "disabled", label: "Disabled", selectedKey: "today", isDisabled: true },
] as const

// MESSAGE

const Message = defineMessageUnion({
	GotSelectMessage: { id: Schema.String, message: Select.Message },
})
type Message = typeof Message.Type

// UPDATE

const foldSelectOutMessage = Select.OutMessage.match<Update.Step<Model, Message>>({
	ChangedSelection: () => (model) => ({ model }),
})

const foldSelect = (id: string) =>
	Update.foldChild({
		update: Select.update,
		read: (model: Model) => Array.findFirst(model.selects, (select) => select.id === id),
		write: (model, nextSelect) =>
			modifyFields(model, { selects: Array.map((select) => (select.id === id ? nextSelect : select)) }),
		toParentMessage: (message) => Message.GotSelectMessage({ id, message }),
		foldOutMessage: foldSelectOutMessage,
	})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Select", [
		gallerySection(
			h,
			"States",
			Array.map(model.selects, (select) => {
				const example = Array.findFirst(examples, (candidate) => candidate.id === select.id)
				return h.submodel({
					slotId: select.id,
					model: select,
					view: selectView,
					viewInputs: {
						label: example._tag === "Some" ? example.value.label : "",
						placeholder:
							example._tag === "Some" && "placeholder" in example.value
								? example.value.placeholder
								: undefined,
						className: "w-64",
					},
					toParentMessage: (message) => Message.GotSelectMessage({ id: select.id, message }),
				})
			}),
		),
	])

export const gallery = defineGallery<Model, Message>("Select", {
	Model,
	init: () => ({
		model: {
			selects: Array.map(examples, (example) =>
				Select.init({
					id: example.id,
					items: options,
					selectedKey: "selectedKey" in example ? example.selectedKey : undefined,
					isDisabled: "isDisabled" in example ? example.isDisabled : false,
				}),
			),
		},
	}),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotSelectMessage: ({ id, message }) => foldSelect(id)(model, message),
		}),
	view,
})
