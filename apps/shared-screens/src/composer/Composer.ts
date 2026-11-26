// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Phase 1 exit screen: the chat composer (`web-foldkit/src/composer/view.ts`, `draft-view.ts`,
 * `autocomplete-view.ts`, the typing banner) in `hazel`. Type-checks against C1; not rendered yet.
 * The text is a controlled `composer` (G5's revision pair); what sits above it fills its `above` slot.
 */
import { UiSchema } from "@effect/ui"
import { Content, Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Match, Schema } from "effect"

export const Suggestion = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	description: Schema.optional(Schema.String),
	initials: Schema.optional(Schema.String),
	emoji: Schema.optional(Schema.String),
})
export type Suggestion = typeof Suggestion.Type

export const Trigger = Schema.Struct({ kind: Schema.Literals(["@", "#", "/", ":"]), query: Schema.String })

export const Context = Schema.Union([
	Schema.TaggedStruct("None", {}),
	Schema.TaggedStruct("Reply", { author: Schema.String, text: Schema.String }),
	Schema.TaggedStruct("Edit", {}),
])
export type Context = typeof Context.Type

export const ComposerMessage = UiSchema.TaggedEnum({
	ChangedText: { payload: TextField.ChangePayload },
	Submitted: { payload: TextField.ChangePayload },
	ChangedTrigger: { kind: Schema.Literals(["@", "#", "/", ":"]), query: Schema.NullOr(Schema.String) },
	PickedSuggestion: { id: Schema.String },
	DismissedSuggestions: {},
	RemovedAttachment: { id: Schema.String },
	PressedAttach: {},
	PressedGif: {},
	PressedEmoji: {},
	CancelledContext: {},
})
export type ComposerMessage = typeof ComposerMessage.Type

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
		RemovedAttachment: ($, { id }) =>
			$.evolve({ attachments: (all) => all.filter((file) => file.id !== id) }),
		PressedAttach: ($) => $.model,
		PressedGif: ($) => $.model,
		PressedEmoji: ($) => $.model,
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
			// HAZEL-GAP(autocomplete-keys): while a trigger is open, arrows, Enter, Tab and Escape drive the
			// suggestion list instead of the text; the composer needs a `key` event for them.
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
			)
			.actions(
				// HAZEL-GAP(file-picker): Attach opens the platform's file picker; files cannot cross the wire
				// as data, so it needs a platform service (pick, then upload natively) rather than a prop.
				h.button
					.icon("paperclip")
					.label("Attach")
					.variant("ghost")
					.size("xsmall")
					.on("press", ComposerMessage.PressedAttach()),
				// HAZEL-GAP(emoji-gif-picker): the GIF and emoji pickers are dialogs no primitive draws yet.
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
				// HAZEL-GAP(avatar-provider-mark): a mention's avatar carries a presence dot or a provider mark.
				.leading(
					item.emoji === undefined
						? h.avatar.name(item.label).initials(item.initials)
						: h.text.children(item.emoji),
				)
				.on("press", ComposerMessage.PickedSuggestion({ id: item.id }))

		// HAZEL-GAP(field-required): the bot command panel's fields mark required arguments.
		return h.stack.density("compact").children(
			// HAZEL-GAP(file-drop): dropping or pasting files onto the composer (the drop overlay).
			h.popover
				.open(model.trigger !== null && model.suggestions.length > 0)
				.on("dismiss", ComposerMessage.DismissedSuggestions())
				.anchor(composer)
				.children(...model.suggestions.map(suggestion)),
			model.typing.length === 0 ? null : h.typingIndicator.names(model.typing),
		)
	},
})
