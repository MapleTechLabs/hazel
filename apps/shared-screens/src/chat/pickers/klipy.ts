// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The GIF picker's data (`SearchGifs`, `GifCategories`) from KLIPY through Hazel's API, for every
 * host: the web and the native app provide the same layer on their own `HazelApiClient`.
 */
import { HazelApiClient } from "@hazel/client-data"
import type { KlipyGif } from "@hazel/domain/http"
import { Effect, Layer } from "effect"
import { type Gif, GifCategories, SearchGifs } from "./GifPicker"

const PER_PAGE = 25

/** The HD GIF as what is sent; the small jpg still, animating as the small webp (as today). */
export const toGif = (gif: KlipyGif): Gif => ({
	url: gif.file.hd.gif.url,
	still: gif.file.sm.jpg.url,
	animated: gif.file.sm.webp.url,
	title: gif.title,
	width: gif.file.sm.jpg.width,
	height: gif.file.sm.jpg.height,
})

// BOUNDARY: KLIPY's own failure, else a transport or decode one; the picker says so.
const reasonOf = (error: { readonly _tag: string }) =>
	error._tag === "KlipyApiError" ? ("ProviderFailed" as const) : ("Unavailable" as const)

const searchGifs = SearchGifs.toLayer(
	Effect.map(
		Effect.service(HazelApiClient),
		(client) =>
			({ query, page }: { readonly query: string; readonly page: number }) =>
				(query === ""
					? client.klipy.trending({ query: { page, per_page: PER_PAGE } })
					: client.klipy.search({ query: { q: query, page, per_page: PER_PAGE } })
				).pipe(
					Effect.map((response) => ({
						gifs: response.data.map(toGif),
						hasNext: response.has_next,
					})),
					Effect.tapCause((cause) => Effect.logWarning("GIF search failed", cause)),
					Effect.mapError(reasonOf),
				),
	),
)

const gifCategories = GifCategories.toLayer(
	Effect.map(
		Effect.service(HazelApiClient),
		(client) => () =>
			client.klipy.categories().pipe(
				Effect.map((response) =>
					response.categories.map(({ category, query }) => ({ label: category, query })),
				),
				Effect.tapCause((cause) => Effect.logWarning("GIF categories failed", cause)),
				Effect.mapError(reasonOf),
			),
	),
)

/** `SearchGifs` and `GifCategories`; needs a `HazelApiClient`. */
export const klipyGifsLayer = Layer.mergeAll(searchGifs, gifCategories)
