import { HazelApi } from "@hazel/domain/http"
import { Context, type Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { RpcClient, RpcSerialization } from "effect/rpc"
import {
	AttachmentRpcs,
	BotRpcs,
	ChannelMemberRpcs,
	ChannelRpcs,
	ChannelSectionRpcs,
	ChannelWebhookRpcs,
	ChatSyncRpcs,
	ConnectShareRpcs,
	CustomEmojiRpcs,
	GitHubSubscriptionRpcs,
	IntegrationRequestRpcs,
	MessageReactionRpcs,
	MessageRpcs,
	NotificationRpcs,
	OrganizationMemberRpcs,
	OrganizationRpcs,
	PinnedMessageRpcs,
	RssSubscriptionRpcs,
	TypingIndicatorRpcs,
	UserPresenceStatusRpcs,
	UserRpcs,
} from "@hazel/domain/rpc"
import { AuthMiddlewareClientLive } from "~/lib/rpc-auth-middleware"
import { CustomFetchLive } from "~/lib/services/common/api-client"

/** Same groups, transport and auth middleware as the legacy `HazelRpcClient`, as a plain Effect service. */
const AllRpcs = MessageRpcs.merge(
	NotificationRpcs,
	IntegrationRequestRpcs,
	ChannelRpcs,
	ChannelMemberRpcs,
	ChannelSectionRpcs,
	ChannelWebhookRpcs,
	CustomEmojiRpcs,
	GitHubSubscriptionRpcs,
	RssSubscriptionRpcs,
	OrganizationRpcs,
	OrganizationMemberRpcs,
	UserRpcs,
	MessageReactionRpcs,
	TypingIndicatorRpcs,
	PinnedMessageRpcs,
	AttachmentRpcs,
	UserPresenceStatusRpcs,
	BotRpcs,
	ConnectShareRpcs,
).merge(ChatSyncRpcs)

const makeClient = RpcClient.make(AllRpcs, { flatten: true })

export class HazelRpc extends Context.Service<HazelRpc, Effect.Success<typeof makeClient>>()("HazelRpc") {}

const ProtocolLive = RpcClient.layerProtocolHttp({ url: `${import.meta.env.VITE_BACKEND_URL}/rpc` }).pipe(
	Layer.provide(FetchHttpClient.layer),
	Layer.provide(RpcSerialization.layerNdjson),
)

export const HazelRpcLive = Layer.effect(HazelRpc, makeClient).pipe(
	Layer.provide(Layer.mergeAll(ProtocolLive, AuthMiddlewareClientLive)),
)

const makeApiClient = HttpApiClient.make(HazelApi, {
	baseUrl: import.meta.env.VITE_BACKEND_URL || "http://localhost:3003",
})

/** The legacy `HazelApiClient` (HTTP API, not RPC): same API, base URL and authenticated fetch. */
export class HazelApiClient extends Context.Service<HazelApiClient, Effect.Success<typeof makeApiClient>>()(
	"HazelApiClient",
) {}

export const HazelApiClientLive = Layer.effect(HazelApiClient, makeApiClient).pipe(Layer.provide(CustomFetchLive))

/** The app's `resources`: what every Command and Subscription may use. */
export type Resources = HazelRpc | HazelApiClient

export const ResourcesLive = Layer.mergeAll(HazelRpcLive, HazelApiClientLive)
