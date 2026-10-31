import { HttpApiBuilder } from "effect/http-api"
import { HttpClient } from "effect/http"
import { KlipyApiError } from "@hazel/domain/http"
import { Config, Effect, Option, Redacted, Schema } from "effect"
import { HazelApi } from "../api"

const KLIPY_BASE_URL = "https://api.klipy.com/api/v1"

const KlipyRawFileVariant = Schema.Struct({
	url: Schema.String,
	width: Schema.Number,
	height: Schema.Number,
	size: Schema.Number,
})

const KlipyRawFileResolution = Schema.Struct({
	gif: KlipyRawFileVariant,
	webp: KlipyRawFileVariant,
	jpg: KlipyRawFileVariant,
	mp4: KlipyRawFileVariant,
	webm: KlipyRawFileVariant,
})

const KlipyRawFile = Schema.Struct({
	hd: KlipyRawFileResolution,
	md: KlipyRawFileResolution,
	sm: KlipyRawFileResolution,
	xs: KlipyRawFileResolution,
})

const KlipyRawGif = Schema.Struct({
	id: Schema.Number,
	slug: Schema.String,
	title: Schema.String,
	file: KlipyRawFile,
	type: Schema.String,
	blur_preview: Schema.String,
})

const KlipyRawSearchResponse = Schema.Struct({
	result: Schema.Boolean,
	data: Schema.Struct({
		data: Schema.Array(KlipyRawGif),
		current_page: Schema.Number,
		per_page: Schema.Number,
		has_next: Schema.Boolean,
	}),
})

const KlipyRawCategory = Schema.Struct({
	category: Schema.String,
	query: Schema.String,
	preview_url: Schema.String,
})

const KlipyRawCategoriesResponse = Schema.Struct({
	result: Schema.Boolean,
	data: Schema.Struct({
		categories: Schema.Array(KlipyRawCategory),
	}),
})

const fetchKlipy = (
	httpClient: HttpClient.HttpClient,
	apiKey: Option.Option<string>,
	path: string,
	params: Record<string, string>,
) => {
	// Optional: a stage without a Klipy key (previews, local dev) answers GIF requests with an error.
	if (Option.isNone(apiKey)) {
		return Effect.fail(new KlipyApiError({ message: "GIF search is not configured (KLIPY_API_KEY)" }))
	}
	const searchParams = new URLSearchParams(params)
	const queryString = searchParams.toString()
	const url = `${KLIPY_BASE_URL}/${apiKey.value}${path}${queryString ? `?${queryString}` : ""}`

	return httpClient.get(url).pipe(
		Effect.flatMap((response) => {
			if (response.status >= 400) {
				return response.text.pipe(
					Effect.flatMap((body) =>
						Effect.fail(
							new KlipyApiError({
								message: `Klipy API error: ${response.status} ${body}`,
							}),
						),
					),
				)
			}
			return response.json
		}),
		Effect.scoped,
		Effect.catchTag("HttpClientError", (error) =>
			Effect.fail(new KlipyApiError({ message: `Klipy request failed: ${String(error)}` })),
		),
	)
}

export const HttpKlipyLive = HttpApiBuilder.group(HazelApi, "klipy", (handlers) =>
	Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient
		const apiKey = Option.map(yield* Config.option(Config.Redacted("KLIPY_API_KEY")), Redacted.value)

		return handlers
			.handle("trending", ({ query }) =>
				Effect.gen(function* () {
					const raw = yield* fetchKlipy(httpClient, apiKey, "/gifs/trending", {
						page: String(query.page),
						per_page: String(query.per_page),
					})
					const parsed = yield* Schema.decodeUnknownEffect(KlipyRawSearchResponse)(raw).pipe(
						Effect.mapError(
							(error) =>
								new KlipyApiError({
									message: `Failed to parse Klipy response: ${String(error)}`,
								}),
						),
					)
					return parsed.data
				}),
			)
			.handle("search", ({ query }) =>
				Effect.gen(function* () {
					const raw = yield* fetchKlipy(httpClient, apiKey, "/gifs/search", {
						q: query.q,
						page: String(query.page),
						per_page: String(query.per_page),
					})
					const parsed = yield* Schema.decodeUnknownEffect(KlipyRawSearchResponse)(raw).pipe(
						Effect.mapError(
							(error) =>
								new KlipyApiError({
									message: `Failed to parse Klipy response: ${String(error)}`,
								}),
						),
					)
					return parsed.data
				}),
			)
			.handle("categories", () =>
				Effect.gen(function* () {
					const raw = yield* fetchKlipy(httpClient, apiKey, "/gifs/categories", {
						locale: "en_US",
					})
					const parsed = yield* Schema.decodeUnknownEffect(KlipyRawCategoriesResponse)(raw).pipe(
						Effect.mapError(
							(error) =>
								new KlipyApiError({
									message: `Failed to parse Klipy categories: ${String(error)}`,
								}),
						),
					)
					return parsed.data
				}),
			)
	}),
)
