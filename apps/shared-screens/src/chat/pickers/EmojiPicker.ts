// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The chat's emoji picker (today's `web-foldkit/src/emoji-picker/`): `hz:emojiPicker` over the full
 * emojibase set, the recently used emojis first, then the organization's custom ones. The parent
 * owns `open` and the custom emojis; a pick reports `Picked` and is remembered, Escape or a press
 * outside reports `RequestedClose`. A spinner shows while the set loads; a failure says so with a retry.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { KeyValue } from "@hazel/client-data"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Schema, Stream } from "effect"
import { categoriesOf, EmojiData, LoadEmojiData } from "./emoji-data"
import {
	decodeRecentEmojis,
	encodeRecentEmojis,
	RECENT_EMOJIS_KEY,
	RecentEmoji,
	withRecentEmoji,
} from "./recent"

export const CustomEmojiProp = Schema.Struct({ name: Schema.String, imageUrl: Schema.String })

export const EmojiPickerProps = Schema.Struct({
	open: Schema.Boolean,
	/** The organization's custom emojis, picked as `:name:`. */
	custom: Schema.optional(Schema.Array(CustomEmojiProp)),
})
export type EmojiPickerProps = typeof EmojiPickerProps.Type

/** The full set: loading (a spinner), loaded, or failed (a reason and a retry). */
export const EmojiCatalog = Schema.Literals(["Loading", "Shown", "Failed"])

export const EmojiPickerModel = Schema.Struct({
	/** This device's picks, newest first; null until read. */
	recent: Schema.NullOr(Schema.Array(RecentEmoji)),
	catalog: EmojiCatalog,
	data: Schema.NullOr(EmojiData),
	/** Bumped by "Try again": a new load. */
	attempt: Schema.Finite,
})

/** Today's copy for an emoji set that would not load (`failureMessage("Unavailable")`). */
export const EMOJI_LOAD_FAILED = "Service temporarily unavailable"
export type EmojiPickerModel = typeof EmojiPickerModel.Type

export const EmojiPickerMessage = UiSchema.TaggedEnum({
	LoadedRecentEmojis: { recent: Schema.Array(RecentEmoji) },
	LoadedEmojiData: { data: EmojiData },
	FailedLoadEmojiData: {},
	RetriedEmojiData: {},
	SelectedEmoji: { emoji: Schema.String },
	DismissedEmojiPicker: {},
})
export type EmojiPickerMessage = typeof EmojiPickerMessage.Type

export const EmojiPickerEvents = UiSchema.TaggedEnum({
	Picked: { emoji: Schema.String },
	RequestedClose: {},
})
export type EmojiPickerEvents = typeof EmojiPickerEvents.Type

/** Remembers the picks; a full or blocked store only forgets them. */
export class SaveRecentEmojis extends Command.Service<SaveRecentEmojis>()("hazel/pickers/SaveRecentEmojis", {
	args: { recent: Schema.Array(RecentEmoji) },
	success: Component.Noop,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(KeyValue),
			(store) =>
				({ recent }) =>
					Effect.sync(() => {
						store.set(RECENT_EMOJIS_KEY, encodeRecentEmojis(recent))
						return Component.noop
					}),
		),
	)
}

/** The stored picks, read once. */
const recentStream = Stream.fromEffect(
	Effect.map(Effect.service(KeyValue), (store) =>
		EmojiPickerMessage.LoadedRecentEmojis({ recent: decodeRecentEmojis(store.get(RECENT_EMOJIS_KEY)) }),
	),
)

/** Loads the dataset (once per run; the query is cached) into the model. */
export const catalogStream = Stream.fromEffect(
	LoadEmojiData.get({ locale: "en" }).pipe(
		Effect.map((data) => EmojiPickerMessage.LoadedEmojiData({ data })),
		Effect.orElseSucceed(() => EmojiPickerMessage.FailedLoadEmojiData()),
	),
)

export const EmojiPickerNoDeps = Hazel.component({
	name: "EmojiPicker",
	props: EmojiPickerProps,
	model: EmojiPickerModel,
	message: EmojiPickerMessage,
	events: EmojiPickerEvents,
}).make({
	init: () => ({ recent: null, catalog: "Loading" as const, data: null, attempt: 0 }),
	update: {
		LoadedRecentEmojis: ($, { recent }) => $.evolve({ recent }),
		LoadedEmojiData: ($, { data }) => $.evolve({ catalog: () => "Shown" as const, data: () => data }),
		FailedLoadEmojiData: ($) => $.evolve({ catalog: "Failed" }),
		RetriedEmojiData: ($) =>
			$.evolve({ catalog: () => "Loading" as const, attempt: (attempt) => attempt + 1 }),
		SelectedEmoji: ($, { emoji }) => {
			// A custom emoji is remembered with its image, so the recent row can draw it.
			const custom = ($.props.custom ?? []).find((each) => `:${each.name}:` === emoji)
			const entry =
				custom === undefined
					? { emoji, label: "", imageUrl: null }
					: { emoji, label: custom.name, imageUrl: custom.imageUrl }
			const recent = withRecentEmoji($.model.recent ?? [], entry)
			return $.evolve({ recent })
				.run(SaveRecentEmojis.make({ recent }))
				.emit(EmojiPickerEvents.Picked({ emoji }))
		},
		DismissedEmojiPicker: ($) => $.emit(EmojiPickerEvents.RequestedClose()),
	},
	subscriptions: ({ model }) => [
		Subscription.make("recent", [], () => recentStream),
		// "Try again" starts a new load.
		model.catalog === "Loading" && Subscription.make("catalog", [model.attempt], () => catalogStream),
	],
	view: (h, model) =>
		h.emojiPicker
			.open(h.props.open)
			.categories(
				model.data === null
					? undefined
					: categoriesOf(model.data, model.recent ?? [], null, h.props.custom ?? []),
			)
			.loading(model.catalog === "Loading")
			.error(model.catalog === "Failed" ? EMOJI_LOAD_FAILED : undefined)
			.on("select", ({ emoji }) => EmojiPickerMessage.SelectedEmoji({ emoji }))
			.on("retry", EmojiPickerMessage.RetriedEmojiData())
			.on("dismiss", EmojiPickerMessage.DismissedEmojiPicker()),
})

/** Leaves the platform's `KeyValue` and `HttpClient` to the host. */
export const emojiPickerLayer = Layer.mergeAll(SaveRecentEmojis.layer, LoadEmojiData.layer)

export const EmojiPicker = EmojiPickerNoDeps.pipe(Component.provide(emojiPickerLayer))
