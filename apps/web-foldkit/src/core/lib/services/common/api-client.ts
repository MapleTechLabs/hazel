import { Effect } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { authenticatedFetch } from "../../auth-fetch"

/** The HTTP client `HazelApiClient` (`src/rpc.ts`) is built on. */
export const CustomFetchLive = FetchHttpClient.layer

/**
 * Every request of `HazelApiClient` goes through `authenticatedFetch` (the session's bearer in the
 * desktop and iOS apps, the cookie in a browser), provided per request. Provided to the layer it
 * was lost: the RPC client builds the same `FetchHttpClient.layer`, which is built once, with the
 * plain `fetch`, so the apps' API calls (GIFs) went out with no session.
 */
export const withSessionFetch = (client: HttpClient.HttpClient): HttpClient.HttpClient =>
	HttpClient.transform(client, (response) =>
		Effect.provideService(response, FetchHttpClient.Fetch, authenticatedFetch),
	)
