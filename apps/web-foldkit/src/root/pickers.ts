// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The web's picker platform (`@hazel/shared-screens/chat/pickers`): the data handed to the web
 * renderers of `hz:emojiPicker` and `GifPicker`, KLIPY as `SearchGifs`, localStorage and `fetch`.
 */
import { KeyValueWeb } from "@hazel/client-data/web"
import type { KlipyGif } from "@hazel/domain/http"
import { PickerCatalog } from "@hazel/shared-screens/chat/pickers/catalog"
import { type Gif, SearchGifs } from "@hazel/shared-screens/chat/pickers/GifPicker"
import { setEmojiSource } from "@hazel/ui/web/primitives/overlays/emoji-data"
import { setGifSource } from "@hazel/ui/web/primitives/overlays/gifPicker"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { HazelApiClient, HazelApiClientLive } from "../rpc"

const PER_PAGE = 25

/** The small still for the grid, the HD GIF as what is sent (as today). */
export const toGif = (gif: KlipyGif): Gif => ({
	url: gif.file.hd.gif.url,
	preview: gif.file.sm.jpg.url,
	title: gif.title,
})

const catalogWeb = Layer.succeed(PickerCatalog, {
	showEmoji: (categories) => Effect.sync(() => setEmojiSource(categories)),
	showGifs: (search) => Effect.sync(() => setGifSource(search === undefined ? undefined : { search })),
})

const searchGifsKlipy = SearchGifs.toLayer(
	Effect.map(
		Effect.service(HazelApiClient),
		(client) =>
			({ query }: { readonly query: string }) =>
				(query === ""
					? client.klipy.trending({ query: { page: 1, per_page: PER_PAGE } })
					: client.klipy.search({ query: { q: query, page: 1, per_page: PER_PAGE } })
				).pipe(
					Effect.map((response) => response.data.map(toGif)),
					Effect.tapCause((cause) => Effect.logWarning("GIF search failed", cause)),
					// BOUNDARY: KLIPY's own failure, else a transport or decode one; the picker says so.
					Effect.mapError((error) =>
						error._tag === "KlipyApiError" ? "ProviderFailed" : "Unavailable",
					),
				),
	),
).pipe(Layer.provide(HazelApiClientLive))

/** No trace headers to the emoji CDN: they make the request need a preflight, which it refuses. */
const cdnHttpClient = Layer.merge(
	FetchHttpClient.layer,
	Layer.succeed(HttpClient.TracerPropagationEnabled, false),
)

export const pickersWebLayer = Layer.mergeAll(catalogWeb, searchGifsKlipy, KeyValueWeb, cdnHttpClient)
