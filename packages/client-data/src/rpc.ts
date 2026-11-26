/**
 * The RPC client: every group the app calls, over HTTP with the auth middleware. Needs the host's
 * `HttpClient`, `Session` (the `authorization` header) and `ClientDataConfig` (the api's URL).
 */
import {
	AssistantRpcs,
	AttachmentRpcs,
	AuthMiddleware,
	BotRpcs,
	ChannelMemberRpcs,
	ChannelRpcs,
	ChannelSectionRpcs,
	ChannelWebhookRpcs,
	ChatSyncRpcs,
	ConnectShareRpcs,
	CustomEmojiRpcs,
	CustomerChatRpcs,
	CustomerRpcs,
	GitHubSubscriptionRpcs,
	IntegrationRequestRpcs,
	InvitationRpcs,
	MessageReactionRpcs,
	MessageRpcs,
	NotificationRpcs,
	OrganizationExportRpcs,
	OrganizationMemberRpcs,
	OrganizationRpcs,
	PinnedMessageRpcs,
	PushDeviceRpcs,
	RssSubscriptionRpcs,
	TypingIndicatorRpcs,
	UserGroupRpcs,
	UserPresenceStatusRpcs,
	UserRpcs,
} from "@hazel/domain/rpc"
import { Context, Effect, Layer } from "effect"
import { Headers } from "effect/http"
import { RpcClient, RpcMiddleware, RpcSerialization } from "effect/rpc"
import { ClientDataConfig, Session } from "./platform/services"

export const AllRpcs = MessageRpcs.merge(
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
	InvitationRpcs,
	OrganizationExportRpcs,
).merge(ChatSyncRpcs, CustomerRpcs, CustomerChatRpcs, PushDeviceRpcs, AssistantRpcs, UserGroupRpcs)

const makeClient = RpcClient.make(AllRpcs, { flatten: true })

export class HazelRpc extends Context.Service<HazelRpc, Effect.Success<typeof makeClient>>()("HazelRpc") {}

/** Adds the host's `authorization` header, when it has one, to every request. */
export const AuthMiddlewareClient = Layer.unwrap(
	Effect.gen(function* () {
		const session = yield* Session
		return RpcMiddleware.layerClient(AuthMiddleware, ({ request, next }) =>
			Effect.gen(function* () {
				const authorization = yield* session.authorization
				return yield* next(
					authorization === null
						? request
						: {
								...request,
								headers: Headers.set(request.headers, "authorization", authorization),
							},
				)
			}),
		)
	}),
)

const Protocol = Layer.unwrap(
	Effect.gen(function* () {
		const config = yield* ClientDataConfig
		return RpcClient.layerProtocolHttp({ url: `${config.apiUrl}/rpc` })
	}),
).pipe(Layer.provide(RpcSerialization.layerNdjson))

export const HazelRpcLayer = Layer.effect(HazelRpc, makeClient).pipe(
	Layer.provide(Layer.mergeAll(Protocol, AuthMiddlewareClient)),
)
