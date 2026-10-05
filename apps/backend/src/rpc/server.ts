import { RpcServer } from "effect/rpc"
import {
	AttachmentRpcs,
	BotRpcs,
	ChannelMemberRpcs,
	ChannelRpcs,
	ChannelSectionRpcs,
	ChatSyncRpcs,
	ChannelWebhookRpcs,
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
import { validateRpcGroupScopes } from "@hazel/domain/scopes"
import { Layer } from "effect"
import { AttachmentRpcLive } from "./handlers/attachments"
import { BotRpcLive } from "./handlers/bots"
import { ChannelMemberRpcLive } from "./handlers/channel-members"
import { ChannelSectionRpcLive } from "./handlers/channel-sections"
import { ChatSyncRpcLive } from "./handlers/chat-sync"
import { ChannelWebhookRpcLive } from "./handlers/channel-webhooks"
import { ChannelRpcLive } from "./handlers/channels"
import { ConnectShareRpcLive } from "./handlers/connect-shares"
import { CustomEmojiRpcLive } from "./handlers/custom-emojis"
import { GitHubSubscriptionRpcLive } from "./handlers/github-subscriptions"
import { IntegrationRequestRpcLive } from "./handlers/integration-requests"
import { RssSubscriptionRpcLive } from "./handlers/rss-subscriptions"
import { MessageReactionRpcLive } from "./handlers/message-reactions"
import { MessageRpcLive } from "./handlers/messages"
import { NotificationRpcLive } from "./handlers/notifications"
import { OrganizationMemberRpcLive } from "./handlers/organization-members"
import { OrganizationRpcLive } from "./handlers/organizations"
import { PinnedMessageRpcLive } from "./handlers/pinned-messages"
import { TypingIndicatorRpcLive } from "./handlers/typing-indicators"
import { UserPresenceStatusRpcLive } from "./handlers/user-presence-status"
import { UserRpcLive } from "./handlers/users"
import { AuthMiddlewareLive } from "./middleware/auth"
import { ScopeInjectionMiddlewareLive } from "./middleware/scope-injection"
import { ScopeInjectionMiddleware } from "@hazel/domain/rpc"

/**
 * RPC Server Configuration
 *
 * This file sets up the Effect RPC server with all RPC groups and their handlers.
 *
 * Architecture:
 * 1. Define RPC groups (in ./groups/*.ts) - API schema definitions
 * 2. Implement handlers (in ./handlers/*.ts) - Business logic
 * 3. Combine into server layer (here) - Server setup
 * 4. Add HTTP protocol (in index.ts) - Transport layer
 *
 */

const BaseRpcs = MessageRpcs.merge(
	MessageReactionRpcs,
	NotificationRpcs,
	IntegrationRequestRpcs,
	TypingIndicatorRpcs,
	PinnedMessageRpcs,
	OrganizationRpcs,
	OrganizationMemberRpcs,
	UserRpcs,
	UserPresenceStatusRpcs,
).merge(
	ChannelRpcs,
	ChannelMemberRpcs,
	ChannelSectionRpcs,
	ChannelWebhookRpcs,
	ConnectShareRpcs,
	GitHubSubscriptionRpcs,
	RssSubscriptionRpcs,
	AttachmentRpcs,
	BotRpcs,
	CustomEmojiRpcs,
)

export const AllRpcs = BaseRpcs.merge(ChatSyncRpcs).middleware(ScopeInjectionMiddleware)

// Startup validation: ensure all RPCs have RequiredScopes annotations
const rpcGroups = [
	["MessageRpcs", MessageRpcs],
	["MessageReactionRpcs", MessageReactionRpcs],
	["NotificationRpcs", NotificationRpcs],
	["IntegrationRequestRpcs", IntegrationRequestRpcs],
	["TypingIndicatorRpcs", TypingIndicatorRpcs],
	["PinnedMessageRpcs", PinnedMessageRpcs],
	["OrganizationRpcs", OrganizationRpcs],
	["OrganizationMemberRpcs", OrganizationMemberRpcs],
	["UserRpcs", UserRpcs],
	["UserPresenceStatusRpcs", UserPresenceStatusRpcs],
	["ChannelRpcs", ChannelRpcs],
	["ChannelMemberRpcs", ChannelMemberRpcs],
	["ChannelSectionRpcs", ChannelSectionRpcs],
	["ChannelWebhookRpcs", ChannelWebhookRpcs],
	["ConnectShareRpcs", ConnectShareRpcs],
	["GitHubSubscriptionRpcs", GitHubSubscriptionRpcs],
	["RssSubscriptionRpcs", RssSubscriptionRpcs],
	["AttachmentRpcs", AttachmentRpcs],
	["BotRpcs", BotRpcs],
	["CustomEmojiRpcs", CustomEmojiRpcs],
	["ChatSyncRpcs", ChatSyncRpcs],
] as const

for (const [name, group] of rpcGroups) {
	const result = validateRpcGroupScopes(group.requests, name)
	if (!result.valid) {
		throw new Error(
			`[RPC Scope Validation] Missing RequiredScopes annotation on: ${result.missing.join(", ")}`,
		)
	}
}

export const RpcServerLive = Layer.empty
	.pipe(
		Layer.provideMerge(MessageRpcLive),
		Layer.provideMerge(MessageReactionRpcLive),
		Layer.provideMerge(NotificationRpcLive),
		Layer.provideMerge(IntegrationRequestRpcLive),
		Layer.provideMerge(TypingIndicatorRpcLive),
		Layer.provideMerge(PinnedMessageRpcLive),
		Layer.provideMerge(OrganizationRpcLive),
		Layer.provideMerge(OrganizationMemberRpcLive),
		Layer.provideMerge(UserRpcLive),
		Layer.provideMerge(UserPresenceStatusRpcLive),
	)
	.pipe(
		Layer.provideMerge(ChannelRpcLive),
		Layer.provideMerge(ChannelMemberRpcLive),
		Layer.provideMerge(ChannelSectionRpcLive),
		Layer.provideMerge(ChatSyncRpcLive),
		Layer.provideMerge(ChannelWebhookRpcLive),
		Layer.provideMerge(ConnectShareRpcLive),
		Layer.provideMerge(GitHubSubscriptionRpcLive),
		Layer.provideMerge(RssSubscriptionRpcLive),
		Layer.provideMerge(AttachmentRpcLive),
		Layer.provideMerge(BotRpcLive),
		Layer.provideMerge(CustomEmojiRpcLive),
	)
	.pipe(Layer.provideMerge(AuthMiddlewareLive), Layer.provideMerge(ScopeInjectionMiddlewareLive))
