import { Effect, Schema } from "effect"
import { Command, type Update } from "foldkit"
import * as Dom from "foldkit/dom"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../ui/aria/interaction"
import {
	searchField,
	searchFieldIds,
	type SearchFieldOptions,
	type SearchFieldParts,
} from "../../ui/search-field"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const Model = Schema.Struct({
	values: Schema.Record(Schema.String, Schema.String),
	interaction: Interaction.Model,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	UpdatedSearch: { field: Schema.String, value: Schema.String },
	ClearedSearch: { field: Schema.String },
	PressedClearButton: { field: Schema.String },
	CompletedFocusSearchInput: {},
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

// COMMAND

const FocusSearchInput = Command.define("FocusSearchInput", {
	args: { field: Schema.String },
	messages: [Message.CompletedFocusSearchInput],
	execute: ({ field }) =>
		Dom.focus(`#${searchFieldIds(field).input}`).pipe(
			Effect.ignore,
			Effect.as(Message.CompletedFocusSearchInput()),
		),
})

// UPDATE

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		UpdatedSearch: ({ field, value }) => ({
			model: modifyFields(model, { values: (values) => ({ ...values, [field]: value }) }),
		}),
		ClearedSearch: ({ field }) => ({
			model: modifyFields(model, { values: (values) => ({ ...values, [field]: "" }) }),
		}),
		PressedClearButton: ({ field }) => ({ model, commands: [FocusSearchInput({ field })] }),
		CompletedFocusSearchInput: () => ({ model }),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})

// VIEW

const initialValues: Record<string, string> = {
	messages: "",
	channels: "general",
	disabled: "Disabled",
	members: "",
}

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const field = (
		id: string,
		options: Omit<SearchFieldOptions<Message>, "id" | "value">,
		render: (parts: SearchFieldParts<Message>) => Array<Html>,
	) =>
		h.div(
			[h.Class("w-72")],
			[
				searchField(
					h,
					{
						id,
						value: model.values[id] ?? "",
						onInput: (value) => Message.UpdatedSearch({ field: id, value }),
						onClear: Message.ClearedSearch({ field: id }),
						onClearPressStart: Message.PressedClearButton({ field: id }),
						interaction: interaction.wiring(model),
						...options,
					},
					render,
				),
			],
		)
	return galleryFrame(h, "Search field", [
		gallerySection(h, "Search fields", [
			field("messages", { ariaLabel: "Search messages" }, (f) => [
				f.searchInput({ placeholder: "Search messages" }),
			]),
			field("channels", { ariaLabel: "Search channels" }, (f) => [
				f.searchInput({ placeholder: "Search channels" }),
			]),
			field("disabled", { ariaLabel: "Search disabled", isDisabled: true }, (f) => [
				f.searchInput({ placeholder: "Disabled" }),
			]),
		]),
		gallerySection(h, "With label", [
			field("members", {}, (f) => [
				f.label(["Members"]),
				f.searchInput({ placeholder: "Find a member" }),
				f.description(["Search by name or email."]),
			]),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Search field", {
	Model,
	init: () => ({ model: { values: initialValues, interaction: Interaction.init() } }),
	update,
	view,
	subscriptions: interaction.subscriptions,
})
