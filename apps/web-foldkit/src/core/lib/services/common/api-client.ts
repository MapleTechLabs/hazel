import { Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { authenticatedFetch } from "../../auth-fetch"

/** The HTTP client `HazelApiClient` (`src/rpc.ts`) uses: fetch with the session's bearer token. */
export const CustomFetchLive = FetchHttpClient.layer.pipe(
	Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, authenticatedFetch)),
)
