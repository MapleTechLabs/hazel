// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Phase 1 exit screen: the chat composer (`web-foldkit/src/composer/view.ts`, `draft-view.ts`,
 * `autocomplete-view.ts`, the typing banner) in `hazel`. Type-checks against C1; not rendered yet.
 * The text is a controlled `composer` (G5's revision pair); what sits above it fills its `above` slot.
 */
import { Command, UiSchema } from "@effect/ui"
import { Files, type PickedFile } from "@hazel/client-data/platform"
import { GifPicker } from "@hazel/ui/extensions/GifPicker"
import { ComposerKey, Content, Hazel, ProviderMark, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Match, Schema } from "effect"

export const Suggestion = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	description: Schema.optional(Schema.String),
	initials: Schema.optional(Schema.String),
	emoji: Schema.optional(Schema.String),
	/** A synced member's provider mark on their avatar. */
	mark: Schema.optional(ProviderMark),
})
export type Suggestion = typeof Suggestion.Type

export const Trigger = Schema.Struct({ kind: Schema.Literals(["@", "#", "/", ":"]), query: Schema.String })

export const Context = Schema.Union([
	Schema.TaggedStruct("None", {}),
	Schema.TaggedStruct("Reply", { author: Schema.String, text: Schema.String }),
	Schema.TaggedStruct("Edit", {}),
])
export type Context = typeof Context.Type

/** A bot command's argument field (the command panel above the text). */
export const CommandField = Schema.Struct({
	name: Schema.String,
	label: Schema.String,
	required: Schema.Boolean,
	value: TextField.State,
})
export type CommandField = typeof CommandField.Type

export const Picker = Schema.Literals(["none", "emoji", "gif"])

export const ComposerMessage = UiSchema.TaggedEnum({
	ChangedText: { payload: TextField.ChangePayload },
	Submitted: { payload: TextField.ChangePayload },
	ChangedTrigger: { kind: Schema.Literals(["@", "#", "/", ":"]), query: Schema.NullOr(Schema.String) },
	PickedSuggestion: { id: Schema.String },
	DismissedSuggestions: {},
	PressedSuggestionKey: { key: ComposerKey },
	RemovedAttachment: { id: Schema.String },
	PressedAttach: {},
	DroppedFiles: {},
	AddedFiles: { files: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })) },
	FailedFiles: {},
	PressedGif: {},
	PressedEmoji: {},
	PickedEmoji: { emoji: Schema.String },
	PickedGif: { url: Schema.String },
	DismissedPicker: {},
	ChangedCommandField: { name: Schema.String, payload: TextField.ChangePayload },
	CancelledContext: {},
})
export type ComposerMessage = typeof ComposerMessage.Type

const added = (files: ReadonlyArray<PickedFile>) =>
	ComposerMessage.AddedFiles({ files: files.map((file) => ({ id: file.attachmentId, name: file.name })) })

/** Attach: the platform's picker, files uploaded natively (lane F implements `Files`). */
export class PickFiles extends Command.Service<PickFiles>()("composer/PickFiles", {
	args: {},
	success: ComposerMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const files = yield* Files
			return () =>
				files
					.pick({ accept: "any", multiple: true })
					.pipe(Effect.match({ onSuccess: added, onFailure: () => ComposerMessage.FailedFiles() }))
		}),
	)
}

/** Files dropped or pasted onto the composer: the host holds them until taken. */
export class TakeDroppedFiles extends Command.Service<TakeDroppedFiles>()("composer/TakeDroppedFiles", {
	args: {},
	success: ComposerMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const files = yield* Files
			return () =>
				files.dropped.pipe(
					Effect.match({ onSuccess: added, onFailure: () => ComposerMessage.FailedFiles() }),
				)
		}),
	)
}

export const ComposerProps = Schema.Struct({ placeholder: Schema.String })

export const Composer = Hazel.component({
	name: "Composer",
	props: ComposerProps,
	model: Schema.Struct({
		draft: TextField.State,
		attachments: Schema.Array(Content.Attachment),
		context: Context,
		trigger: Schema.NullOr(Trigger),
		suggestions: Schema.Array(Suggestion),
		typing: Schema.Array(Schema.String),
		sending: Schema.Boolean,
		picker: Picker,
		commandFields: Schema.Array(CommandField),
	}),
	message: ComposerMessage,
}).make({
	init: () => ({
		draft: TextField.empty,
		attachments: [],
		context: { _tag: "None" },
		trigger: null,
		suggestions: [],
		typing: [],
		sending: false,
		picker: "none",
		commandFields: [],
	}),
	update: {
		ChangedText: ($, { payload }) => $.evolve({ draft: (draft) => TextField.changed(draft, payload) }),
		// Clear on send: a Model edit, so the field rebases anything typed after the submit (G5).
		Submitted: ($) =>
			$.evolve({
				draft: (draft) => TextField.set(draft, ""),
				context: () => ({ _tag: "None" as const }),
			}),
		ChangedTrigger: ($, { kind, query }) =>
			$.evolve({ trigger: () => (query === null ? null : { kind, query }) }),
		PickedSuggestion: ($) => $.evolve({ trigger: () => null }),
		DismissedSuggestions: ($) => $.evolve({ trigger: () => null }),
		PressedSuggestionKey: ($, { key }) =>
			key === "escape" ? $.evolve({ trigger: () => null }) : $.model,
		RemovedAttachment: ($, { id }) =>
			$.evolve({ attachments: (all) => all.filter((file) => file.id !== id) }),
		PressedAttach: ($) => $.run(PickFiles.make({})),
		DroppedFiles: ($) => $.run(TakeDroppedFiles.make({})),
		AddedFiles: ($, { files }) =>
			$.evolve({
				attachments: (all) => [
					...all,
					...files.map((file) => ({ id: file.id, kind: "file" as const, name: file.name })),
				],
			}),
		FailedFiles: ($) => $.model,
		PressedGif: ($) => $.evolve({ picker: () => "gif" as const }),
		PressedEmoji: ($) => $.evolve({ picker: () => "emoji" as const }),
		PickedEmoji: ($) => $.evolve({ picker: () => "none" as const }),
		PickedGif: ($) => $.evolve({ picker: () => "none" as const }),
		DismissedPicker: ($) => $.evolve({ picker: () => "none" as const }),
		ChangedCommandField: ($, { name, payload }) =>
			$.evolve({
				commandFields: (all) =>
					all.map((field) =>
						field.name === name
							? { ...field, value: TextField.changed(field.value, payload) }
							: field,
					),
			}),
		CancelledContext: ($) => $.evolve({ context: () => ({ _tag: "None" as const }) }),
	},
	view: (h, model) => {
		const context = Match.valueTags(model.context, {
			None: () => null,
			Reply: ({ author, text }) =>
				h.stack
					.axis("horizontal")
					.align("center")
					.children(
						h.text.tone("muted").children("Replying to"),
						h.text.strong().children(author),
						h.text.tone("muted").truncate().children(text),
						h.spacer,
						h.button
							.icon("close")
							.iconOnly()
							.variant("ghost")
							.size("xsmall")
							.label("Cancel reply")
							.on("press", ComposerMessage.CancelledContext()),
					),
			Edit: () =>
				h.stack
					.axis("horizontal")
					.align("center")
					.children(
						h.icon.name("edit"),
						h.text.tone("accent").children("Editing message"),
						h.spacer,
						h.button
							.icon("close")
							.iconOnly()
							.variant("ghost")
							.size("xsmall")
							.label("Cancel edit")
							.on("press", ComposerMessage.CancelledContext()),
					),
		})

		const composer = h.composer
			.placeholder(h.props.placeholder)
			.value(model.draft)
			.canSend(model.draft.text.trim() !== "" || model.attachments.length > 0)
			.disabled(model.sending)
			.on("key", ({ key }) => ComposerMessage.PressedSuggestionKey({ key }))
			.on("files", () => ComposerMessage.DroppedFiles())
			.on("change", (payload) => ComposerMessage.ChangedText({ payload }))
			.on("submit", (payload) => ComposerMessage.Submitted({ payload }))
			.on("trigger", ({ kind, query }) => ComposerMessage.ChangedTrigger({ kind, query }))
			.above(
				model.attachments.length === 0
					? null
					: h.attachmentGrid
							.attachments(model.attachments)
							.removable()
							.on("remove", ({ id }) => ComposerMessage.RemovedAttachment({ id })),
				context,
				...model.commandFields.map((field) =>
					h.textField
						.key(field.name)
						.label(field.label)
						.required(field.required)
						.value(field.value)
						.on("change", (payload) =>
							ComposerMessage.ChangedCommandField({ name: field.name, payload }),
						),
				),
			)
			.actions(
				h.button
					.icon("paperclip")
					.label("Attach")
					.variant("ghost")
					.size("xsmall")
					.on("press", ComposerMessage.PressedAttach()),
				h.button
					.icon("gif")
					.label("GIF")
					.variant("ghost")
					.size("xsmall")
					.on("press", ComposerMessage.PressedGif()),
				h.button
					.icon("emoji")
					.label("Emoji")
					.variant("ghost")
					.size("xsmall")
					.on("press", ComposerMessage.PressedEmoji()),
			)

		const suggestion = (item: Suggestion) =>
			h.item
				.key(item.id)
				.title(item.label)
				.subtitle(item.description)
				.leading(
					item.emoji === undefined
						? h.avatar
								.name(item.label)
								.initials(item.initials)
								.mark(item.mark ?? "none")
						: h.text.children(item.emoji),
				)
				.on("press", ComposerMessage.PickedSuggestion({ id: item.id }))

		return h.stack.density("compact").children(
			h.emojiPicker
				.open(model.picker === "emoji")
				.on("select", ({ emoji }) => ComposerMessage.PickedEmoji({ emoji }))
				.on("dismiss", ComposerMessage.DismissedPicker()),
			// Web only: iOS draws nothing in its place.
			h
				.extension(GifPicker, { open: model.picker === "gif" })
				.on("select", ({ url }) => ComposerMessage.PickedGif({ url }))
				.on("dismiss", ComposerMessage.DismissedPicker()),
			h.popover
				.open(model.trigger !== null && model.suggestions.length > 0)
				.on("dismiss", ComposerMessage.DismissedSuggestions())
				.anchor(composer)
				.children(...model.suggestions.map(suggestion)),
			model.typing.length === 0 ? null : h.typingIndicator.names(model.typing),
		)
	},
})
