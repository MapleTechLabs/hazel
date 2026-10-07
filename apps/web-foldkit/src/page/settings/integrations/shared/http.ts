import { HazelApi } from "@hazel/domain/http"
import { Effect } from "effect"
import { HttpApiClient } from "effect/http-api"
import { CustomFetchLive } from "~/lib/services/common/api-client"

/**
 * The legacy `HazelApiClient` (HTTP API, not RPC): same API, base URL and authenticated fetch.
 * The app has no HTTP API resource yet, so each Command builds the client it needs.
 */
export const hazelApi = HttpApiClient.make(HazelApi, {
	baseUrl: import.meta.env.VITE_BACKEND_URL || "http://localhost:3003",
})

export type HazelApiClient = Effect.Success<typeof hazelApi>

export const withHazelApi = <A, E>(use: (client: HazelApiClient) => Effect.Effect<A, E>) =>
	Effect.flatMap(hazelApi, use).pipe(Effect.provide(CustomFetchLive))
