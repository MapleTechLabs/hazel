// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The chat's emoji picker (today's `web-foldkit/src/emoji-picker/`): `hz:emojiPicker` over the full
 * emojibase set, the recently used emojis first. The parent owns `open`; a pick reports `Picked`
 * and is remembered, Escape or a press outside reports `RequestedClose`.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { KeyValue } from "@hazel/client-data"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Schema, Stream } from "effect"
import { PickerCatalog } from "./catalog"
import { categoriesOf, LoadEmojiData } from "./emoji-data"
import {
	decodeRecentEmojis,
	encodeRecentEmojis,
	RECENT_EMOJIS_KEY,
	RecentEmoji,
	withRecentEmoji,
} from "./recent"

export const EmojiPickerProps = Schema.Struct({ open: Schema.Boolean })
export type EmojiPickerProps = typeof EmojiPickerProps.Type

/** Whether the full set reached the picker; until it does (or when it fails) the built-in set shows. */
export const EmojiCatalog = Schema.Literals(["Loading", "Shown", "Failed"])

export const EmojiPickerModel = Schema.Struct({
	/** This device's picks, newest first; null until read. */
	recent: Schema.NullOr(Schema.Array(RecentEmoji)),
	catalog: EmojiCatalog,
})
export type EmojiPickerModel = typeof EmojiPickerModel.Type

export const EmojiPickerMessage = UiSchema.TaggedEnum({
	LoadedRecentEmojis: { recent: Schema.Array(RecentEmoji) },
	ShowedEmojiCatalog: {},
	FailedLoadEmojiData: {},
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

/** Loads the dataset (once per run) and hands the picker its categories. */
export const catalogStream = (recent: ReadonlyArray<RecentEmoji>) =>
	Stream.fromEffect(
		Effect.gen(function* () {
			const catalog = yield* PickerCatalog
			const data = yield* LoadEmojiData.get({ locale: "en" })
			yield* catalog.showEmoji(categoriesOf(data, recent))
			return EmojiPickerMessage.ShowedEmojiCatalog()
		}).pipe(Effect.orElseSucceed(() => EmojiPickerMessage.FailedLoadEmojiData())),
	)

export const EmojiPickerNoDeps = Hazel.component({
	name: "EmojiPicker",
	props: EmojiPickerProps,
	model: EmojiPickerModel,
	message: EmojiPickerMessage,
	events: EmojiPickerEvents,
}).make({
	init: () => ({ recent: null, catalog: "Loading" as const }),
	update: {
		LoadedRecentEmojis: ($, { recent }) => $.evolve({ recent }),
		ShowedEmojiCatalog: ($) => $.evolve({ catalog: "Shown" }),
		FailedLoadEmojiData: ($) => $.evolve({ catalog: "Failed" }),
		SelectedEmoji: ($, { emoji }) => {
			const recent = withRecentEmoji($.model.recent ?? [], { emoji, label: "", imageUrl: null })
			return $.evolve({ recent })
				.run(SaveRecentEmojis.make({ recent }))
				.emit(EmojiPickerEvents.Picked({ emoji }))
		},
		DismissedEmojiPicker: ($) => $.emit(EmojiPickerEvents.RequestedClose()),
	},
	subscriptions: ({ props, model }) => {
		const recent = model.recent
		return [
			Subscription.make("recent", [], () => recentStream),
			recent !== null &&
				Subscription.make(
					"catalog",
					// A failed load tries again the next time the picker opens.
					[recent.map((entry) => entry.emoji).join(" "), model.catalog === "Failed" && props.open],
					() => catalogStream(recent),
				),
		]
	},
	// HAZEL-GAP(emoji-picker-data): the set reaches the renderer through `PickerCatalog`, not a prop.
	// HAZEL-GAP(emoji-picker-layout): today's 9 columns, footer and search icon are the renderer's to draw.
	view: (h) =>
		h.emojiPicker
			.open(h.props.open)
			.on("select", ({ emoji }) => EmojiPickerMessage.SelectedEmoji({ emoji }))
			.on("dismiss", EmojiPickerMessage.DismissedEmojiPicker()),
})

/** Leaves the platform's `KeyValue`, `HttpClient` and `PickerCatalog` to the host. */
export const emojiPickerLayer = Layer.mergeAll(SaveRecentEmojis.layer, LoadEmojiData.layer)

export const EmojiPicker = EmojiPickerNoDeps.pipe(Component.provide(emojiPickerLayer))
