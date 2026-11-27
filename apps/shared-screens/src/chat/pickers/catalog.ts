/**
 * What the platform's pickers offer. `hz:emojiPicker` and the `GifPicker` extension take no data
 * props (HAZEL-GAP `emoji-picker-data`, `gif-picker-results`), so the pickers hand their data to
 * the renderer through this service: the web root's Layer feeds the web renderers, others drop it.
 */
import { Context, Effect, Layer } from "effect"
import type { PickerCategory } from "./emoji-data"

export interface Gif {
	readonly url: string
	readonly preview: string
	readonly title: string
}

/** Trending for an empty query, else a search; `signal` aborts a superseded one. */
export type GifSearch = (query: string, signal: AbortSignal) => Promise<ReadonlyArray<Gif>>

export class PickerCatalog extends Context.Service<
	PickerCatalog,
	{
		readonly showEmoji: (categories: ReadonlyArray<PickerCategory>) => Effect.Effect<void>
		readonly showGifs: (search: GifSearch | undefined) => Effect.Effect<void>
	}
>()("hazel/pickers/PickerCatalog") {}

/** A host without picker renderers (iOS for now, tests): nothing to feed. */
export const pickerCatalogNone = Layer.succeed(PickerCatalog, {
	showEmoji: () => Effect.void,
	showGifs: () => Effect.void,
})
