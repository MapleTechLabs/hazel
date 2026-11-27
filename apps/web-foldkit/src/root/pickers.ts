// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The web's picker platform (`@hazel/shared-screens/chat/pickers`): KLIPY as `SearchGifs` and
 * `GifCategories`, localStorage and `fetch`. The pickers pass their data to the renderers as props.
 */
import { KeyValueWeb } from "@hazel/client-data/web"
import type { KlipyGif } from "@hazel/domain/http"
import { type Gif, GifCategories, SearchGifs } from "@hazel/shared-screens/chat/pickers/GifPicker"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { HazelApiClient, HazelApiClientLive } from "../rpc"

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

const searchGifsKlipy = SearchGifs.toLayer(
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
).pipe(Layer.provide(HazelApiClientLive))

const gifCategoriesKlipy = GifCategories.toLayer(
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
).pipe(Layer.provide(HazelApiClientLive))

/** No trace headers to the emoji CDN: they make the request need a preflight, which it refuses. */
const cdnHttpClient = Layer.merge(
	FetchHttpClient.layer,
	Layer.succeed(HttpClient.TracerPropagationEnabled, false),
)

export const pickersWebLayer = Layer.mergeAll(searchGifsKlipy, gifCategoriesKlipy, KeyValueWeb, cdnHttpClient)
