/**
 * @module API client with platform-aware authentication
 * @platform shared (with platform-specific sections)
 * @description HTTP client that uses Bearer tokens for desktop and cookies for web
 */

import { FetchHttpClient, HttpClient, HttpClientError } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { HazelApi } from "@hazel/domain/http"
import { Context, Layer } from "effect"
import * as Effect from "effect/Effect"
import { authenticatedFetch } from "../../auth-fetch"

export const CustomFetchLive = FetchHttpClient.layer.pipe(
	Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, authenticatedFetch)),
)

export class ApiClient extends Context.Service<ApiClient>()("ApiClient", {
	make: Effect.gen(function* () {
		return yield* HttpApiClient.make(HazelApi, {
			baseUrl: import.meta.env.VITE_BACKEND_URL,
			transformClient: (client) =>
				client.pipe(
					HttpClient.retry({
						times: 3,
						// Only retry server errors (5xx), not client errors (4xx) like 401/403
						while: (error) => {
							if (HttpClientError.isHttpClientError(error)) {
								const status = error.response?.status
								return status === undefined || (status >= 500 && status < 600)
							}
							return false
						},
					}),
				),
		})
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(CustomFetchLive))
}
