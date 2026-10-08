import { Schema } from "effect"
import type { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../ui/aria/interaction"

/** A tiny parent for the stateless form controls: the page's interaction Model plus one value of each kind. */

export const Model = Schema.Struct({
	interaction: Interaction.Model,
	isSelected: Schema.Boolean,
	choice: Schema.NullOr(Schema.String),
	pressCount: Schema.Number,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	ChangedSelection: { isSelected: Schema.Boolean },
	ChoseValue: { value: Schema.String },
	ClickedButton: {},
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type

export const init = (overrides: Partial<Model> = {}): Model => ({
	interaction: Interaction.init(),
	isSelected: false,
	choice: null,
	pressCount: 0,
	...overrides,
})

export const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		ChangedSelection: ({ isSelected }) => ({ model: modifyFields(model, { isSelected: () => isSelected }) }),
		ChoseValue: ({ value }) => ({ model: modifyFields(model, { choice: () => value }) }),
		ClickedButton: () => ({ model: modifyFields(model, { pressCount: (count) => count + 1 }) }),
		GotInteractionMessage: ({ message }) => ({
			model: modifyFields(model, { interaction: () => Interaction.update(model.interaction, message).model }),
		}),
	})

export const wiring = (model: Model): Interaction.Wiring<Message> => ({
	model: model.interaction,
	toParentMessage: (message) => Message.GotInteractionMessage({ message }),
})

/** Wraps one control in a page root so Scene has a stable element to render into. */
export const page = (h: HtmlBuilder<Message>, children: Array<Html>): Html => h.main([], children)
