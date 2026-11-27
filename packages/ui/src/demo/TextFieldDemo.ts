// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * G5's demo: a text field bound to Model. Typing uppercases `#tags`, submit trims trailing spaces,
 * keeps the line and clears the field; an empty submit shows an error. Both hosts draw it.
 */
import { UiSchema } from "@effect/ui"
import { Schema } from "effect"
import { Hazel, TextField } from "../vocabulary/index.ts"

const Edit = { value: Schema.String, rev: Schema.Finite, edit: Schema.Finite }

export const TextFieldDemoMessage = UiSchema.TaggedEnum({
	Changed: Edit,
	Submitted: Edit,
})

/** `#tag` words in upper case: a Model transform of what the user typed. */
export const tagsUpper = (text: string) => text.replace(/#\w+/g, (tag) => tag.toUpperCase())

export const TextFieldDemo = Hazel.component({
	name: "TextFieldDemo",
	props: Schema.Struct({}),
	model: Schema.Struct({
		field: TextField.State,
		sent: Schema.Array(Schema.String),
		error: Schema.NullOr(Schema.String),
	}),
	message: TextFieldDemoMessage,
}).make({
	init: () => ({ field: TextField.empty, sent: [], error: null }),
	update: {
		Changed: ($, edit) => {
			const field = TextField.changed($.model.field, edit)
			return $.evolve({ field: () => TextField.set(field, tagsUpper(field.text)), error: () => null })
		},
		Submitted: ($, edit) => {
			// A submit of text the Model already replaced (a second Enter before the clear landed).
			if (!TextField.current($.model.field, edit)) return $.evolve({})
			const line = edit.value.trimEnd()
			if (line.trim() === "") return $.evolve({ error: () => "Type something first" })
			// Cleared against the revision the submit came from: a Model edit.
			const field = TextField.set(TextField.changed($.model.field, edit), "")
			return $.evolve({ field: () => field, sent: (sent) => [...sent, line], error: () => null })
		},
	},
	view: (h, model) =>
		h.screen.title("Compose").children(
			h.section.title("Message").children(
				h.textField
					.label("Message")
					.placeholder("Type, #tags go upper case")
					.value(model.field)
					.error(model.error ?? undefined)
					.on("change", (edit) => TextFieldDemoMessage.Changed(edit))
					.on("submit", (edit) => TextFieldDemoMessage.Submitted(edit)),
				h.text
					.role("caption")
					.tone("muted")
					.children(`model rev ${model.field.rev}: ${model.field.text}`),
			),
			h.section
				.title("Sent")
				.children(model.sent.map((line, index) => h.item.key(String(index)).title(line))),
		),
})
