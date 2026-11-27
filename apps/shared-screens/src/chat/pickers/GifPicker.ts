// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The chat's GIF picker (today's `web-foldkit/src/gif-picker/`): the `GifPicker` extension (web only)
 * searching through `SearchGifs`, the provider as a query (KLIPY on the web, implemented by the host).
 * The parent owns `open`; a pick reports `Picked` with the GIF's URL.
 */
import { Query, Subscription, UiSchema } from "@effect/ui"
import { GifPicker as GifPickerExtension } from "@hazel/ui/extensions/GifPicker"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Schema, Stream } from "effect"
import { PickerCatalog } from "./catalog"

export const Gif = Schema.Struct({ url: Schema.String, preview: Schema.String, title: Schema.String })
export type Gif = typeof Gif.Type

/** Why a search failed: the provider itself, or anything else on the way. */
export const GifFailure = Schema.Literals(["ProviderFailed", "Unavailable"])
export type GifFailure = typeof GifFailure.Type

/** Trending for an empty `query`, else a search: the first page of results. */
export class SearchGifs extends Query.Service<SearchGifs>()("hazel/pickers/SearchGifs", {
	args: { query: Schema.String },
	success: Schema.Array(Gif),
	error: GifFailure,
	staleTime: "5 minutes",
}) {}

export const GifPickerProps = Schema.Struct({ open: Schema.Boolean })
export type GifPickerProps = typeof GifPickerProps.Type

export const GifPickerModel = Schema.Struct({ connected: Schema.Boolean })
export type GifPickerModel = typeof GifPickerModel.Type

export const GifPickerMessage = UiSchema.TaggedEnum({
	ConnectedGifSearch: {},
	SelectedGif: { url: Schema.String },
	DismissedGifPicker: {},
})
export type GifPickerMessage = typeof GifPickerMessage.Type

export const GifPickerEvents = UiSchema.TaggedEnum({
	Picked: { url: Schema.String },
	RequestedClose: {},
})
export type GifPickerEvents = typeof GifPickerEvents.Type

/** While mounted, the picker searches through `SearchGifs` (cached, so trending loads once). */
export const connectStream = Stream.unwrap(
	Effect.gen(function* () {
		const catalog = yield* PickerCatalog
		const services = yield* Effect.context<SearchGifs | Query.Cache>()
		const search = (query: string, signal: AbortSignal) =>
			Effect.runPromiseWith(services)(SearchGifs.get({ query }), { signal })
		return Stream.fromEffect(
			Effect.as(catalog.showGifs(search), GifPickerMessage.ConnectedGifSearch()),
		).pipe(Stream.concat(Stream.never), Stream.ensuring(catalog.showGifs(undefined)))
	}),
)

export const GifPicker = Hazel.component({
	name: "GifPicker",
	props: GifPickerProps,
	model: GifPickerModel,
	message: GifPickerMessage,
	events: GifPickerEvents,
}).make({
	init: () => ({ connected: false }),
	update: {
		ConnectedGifSearch: ($) => $.evolve({ connected: true }),
		SelectedGif: ($, { url }) => $.emit(GifPickerEvents.Picked({ url })),
		DismissedGifPicker: ($) => $.emit(GifPickerEvents.RequestedClose()),
	},
	subscriptions: () => [Subscription.make("search", [], () => connectStream)],
	// Web only: iOS draws nothing in its place.
	// HAZEL-GAP(gif-picker-results): results reach the extension through `PickerCatalog`, not props.
	view: (h) =>
		h
			.extension(GifPickerExtension, { open: h.props.open })
			.on("select", ({ url }) => GifPickerMessage.SelectedGif({ url }))
			.on("dismiss", GifPickerMessage.DismissedGifPicker()),
})
