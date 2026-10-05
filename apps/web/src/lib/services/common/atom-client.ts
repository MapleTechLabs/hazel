import { AtomHttpApi } from "effect/reactivity"
import { HazelApi } from "@hazel/domain/http"
import { CustomFetchLive } from "./api-client"

export class HazelApiClient extends AtomHttpApi.Service<HazelApiClient>()("HazelApiClient", {
	api: HazelApi,
	httpClient: CustomFetchLive,
	baseUrl: import.meta.env.VITE_BACKEND_URL || "http://localhost:3003",
}) {}
