import { Reactivity } from "effect/reactivity"
import { FetchHttpClient } from "effect/http"
import { RpcClient as RpcClientBuilder, RpcSerialization } from "effect/rpc"
import { AtomRpc } from "effect/reactivity"
import { AuthMiddlewareClientLive } from "~/lib/rpc-auth-middleware"
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
	RssSubscriptionRpcs,
	MessageReactionRpcs,
	MessageRpcs,
	NotificationRpcs,
	OrganizationMemberRpcs,
	OrganizationRpcs,
	PinnedMessageRpcs,
	TypingIndicatorRpcs,
	UserPresenceStatusRpcs,
	UserRpcs,
} from "@hazel/domain/rpc"
import { Layer } from "effect"

const backendUrl = import.meta.env.VITE_BACKEND_URL
const httpUrl = `${backendUrl}/rpc`

const BaseProtocolLive = RpcClientBuilder.layerProtocolHttp({
	url: httpUrl,
}).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(RpcSerialization.layerNdjson))

export const RpcProtocolLive = BaseProtocolLive

// Build the protocol layer with middleware
// Use Layer.mergeAll to make AuthMiddlewareClientLive available alongside the protocol
const AtomRpcProtocolLive = Layer.mergeAll(RpcProtocolLive, AuthMiddlewareClientLive, Reactivity.layer)

const BaseRpcs = MessageRpcs.merge(
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
)

const AllRpcs = BaseRpcs.merge(ChatSyncRpcs)
export class HazelRpcClient extends AtomRpc.Service<HazelRpcClient>()("HazelRpcClient", {
	group: AllRpcs,
	protocol: AtomRpcProtocolLive,
}) {
	static readonly layer = Layer.effect(
		HazelRpcClient,
		RpcClientBuilder.make(AllRpcs, { flatten: true }),
	).pipe(Layer.provide(AtomRpcProtocolLive))
}

export type { RpcClientError } from "effect/rpc"
