import { HazelRpc, HazelRpcLayer } from "@hazel/client-data"
import { HttpClientWeb } from "@hazel/client-data/web"
import { HazelApi } from "@hazel/domain/http"
import { Context, type Effect, Layer } from "effect"
import { HttpApiClient } from "effect/http-api"
import { CustomFetchLive, withSessionFetch } from "~/lib/services/common/api-client"
import { HazelAuthClient, HazelAuthClientLive } from "./auth/client"
import type { NotificationSinks } from "./app/notification-sinks"
import { MessageWindows, MessageWindowsLive } from "./data/message-windows"
import { EditorRegistry, EditorRegistryLive } from "./editor/registry"
import { apiUrl } from "~/config/server"
import { ClientDataConfigWeb, SessionWeb } from "~/db/platform"

export { HazelRpc }

/** The RPC client (`@hazel/client-data`) over `fetch`, the session and the chosen server. */
export const HazelRpcLive = HazelRpcLayer.pipe(
	Layer.provide(Layer.mergeAll(HttpClientWeb, SessionWeb, ClientDataConfigWeb)),
)

const makeApiClient = HttpApiClient.make(HazelApi, {
	baseUrl: apiUrl(),
	transformClient: withSessionFetch,
})

/** The legacy `HazelApiClient` (HTTP API, not RPC): same API, base URL and authenticated fetch. */
export class HazelApiClient extends Context.Service<HazelApiClient, Effect.Success<typeof makeApiClient>>()(
	"HazelApiClient",
) {}

export const HazelApiClientLive = Layer.effect(HazelApiClient, makeApiClient).pipe(
	Layer.provide(CustomFetchLive),
)

/** The app's `resources`: what every Command and Subscription may use. */
export type Resources =
	| HazelRpc
	| HazelApiClient
	| MessageWindows
	| HazelAuthClient
	| EditorRegistry
	// Provided by `entry.ts`: building the sinks touches audio, which tests importing this module lack.
	| NotificationSinks

export const ResourcesLive = Layer.mergeAll(
	HazelRpcLive,
	HazelApiClientLive,
	MessageWindowsLive,
	HazelAuthClientLive,
	EditorRegistryLive,
)
