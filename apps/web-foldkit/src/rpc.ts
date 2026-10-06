import { Context, type Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
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
