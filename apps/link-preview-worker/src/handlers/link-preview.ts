import { HttpApiBuilder } from "effect/http-api"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Effect } from "effect"
import { preview } from "linkpeek"
import { LinkPreviewApi } from "../api"
import { KVCache } from "../cache"
import { LinkPreviewError } from "../declare"

// Validate if an image URL is accessible using HttpClient
function validateImageUrl(url: string) {
	return HttpClient.head(url).pipe(
		Effect.map((response) => {
			const contentType = response.headers["content-type"]
			return contentType ? contentType.startsWith("image/") : false
		}),
		Effect.timeout("1 seconds"),
		Effect.orElseSucceed(() => false as boolean),
		Effect.provide(FetchHttpClient.layer),
	)
}

export const HttpLinkPreviewLive = HttpApiBuilder.group(LinkPreviewApi, "linkPreview", (handlers) =>
	handlers.handle(
		"get",
		Effect.fn(function* ({ payload }) {
			const targetUrl = payload.url
			const cacheKey = `link-preview:${targetUrl}`
			const cache = yield* KVCache

			// Check cache first
			const cachedData = yield* cache
				.get<{
					url?: string
					title?: string
					description?: string
					image?: { url: string }
					logo?: { url: string }
					publisher?: string
				}>(cacheKey)
				.pipe(Effect.orElseSucceed(() => null))

			if (cachedData) {
				yield* Effect.logDebug(`Cache hit for: ${targetUrl}`)
				return cachedData
			}

			yield* Effect.logDebug(`Cache miss - fetching link preview for: ${targetUrl}`)

			// Fetch the page and extract metadata with linkpeek
			const metadata = yield* Effect.tryPromise({
				try: async () => {
					const result = await preview(targetUrl, {
						userAgent: "Mozilla/5.0 (compatible; HazelBot/1.0; +https://hazel.chat/bot)",
						timeout: 10000,
						// Reading stops at </head>; YouTube serves this user agent a ~800 KB head.
						maxBytes: 1_000_000,
					})

					if (result.statusCode >= 400) {
						throw new Error(`HTTP ${result.statusCode}`)
					}

					return result
				},
				catch: (error) =>
					new LinkPreviewError({
						message: `Failed to fetch URL: ${error}`,
					}),
			})

			yield* Effect.logDebug(`Successfully extracted metadata for: ${targetUrl}`)

			// linkpeek picks og:image, then twitter:image, JSON-LD and image_src, as an absolute http(s) URL
			const imageUrl = metadata.image
			const validImageUrl = imageUrl && (yield* validateImageUrl(imageUrl)) ? imageUrl : undefined
			if (imageUrl && !validImageUrl) {
				yield* Effect.logDebug(`Image is not reachable: ${imageUrl}`)
			}

			// Transform to match the frontend schema, converting null to undefined
			const result = {
				url: metadata.canonicalUrl ?? metadata.url,
				title: metadata.title ?? undefined,
				description: metadata.description ?? undefined,
				image: validImageUrl ? { url: validImageUrl } : undefined,
				logo: metadata.favicon ? { url: metadata.favicon } : undefined,
				publisher: metadata.siteName ?? undefined,
			}

			// Store in cache (don't fail request if caching fails)
			yield* cache.set(cacheKey, result).pipe(Effect.orElseSucceed(() => undefined))

			return result
		}),
	),
)
