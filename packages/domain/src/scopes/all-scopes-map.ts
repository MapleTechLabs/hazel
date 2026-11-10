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
	CustomerRpcs,
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
} from "../rpc"
import { mergeScopeMaps, scopeMapFromRpcGroup } from "./scope-map"
import type { ScopeMap } from "./scope-map"

/**
 * Pre-computed scope map for all RPC groups.
 * Built at module initialization time — no runtime cost per check.
 */
export const RPC_SCOPE_MAP: ScopeMap = mergeScopeMaps(
	scopeMapFromRpcGroup(MessageRpcs.requests),
	scopeMapFromRpcGroup(MessageReactionRpcs.requests),
	scopeMapFromRpcGroup(ChannelRpcs.requests),
	scopeMapFromRpcGroup(ChannelMemberRpcs.requests),
	scopeMapFromRpcGroup(ChannelSectionRpcs.requests),
	scopeMapFromRpcGroup(ChannelWebhookRpcs.requests),
	scopeMapFromRpcGroup(ConnectShareRpcs.requests),
	scopeMapFromRpcGroup(OrganizationRpcs.requests),
	scopeMapFromRpcGroup(OrganizationMemberRpcs.requests),
	scopeMapFromRpcGroup(UserRpcs.requests),
	scopeMapFromRpcGroup(NotificationRpcs.requests),
	scopeMapFromRpcGroup(PinnedMessageRpcs.requests),
	scopeMapFromRpcGroup(TypingIndicatorRpcs.requests),
	scopeMapFromRpcGroup(UserPresenceStatusRpcs.requests),
	scopeMapFromRpcGroup(AttachmentRpcs.requests),
	scopeMapFromRpcGroup(BotRpcs.requests),
	scopeMapFromRpcGroup(CustomEmojiRpcs.requests),
	scopeMapFromRpcGroup(CustomerRpcs.requests),
	scopeMapFromRpcGroup(GitHubSubscriptionRpcs.requests),
	scopeMapFromRpcGroup(RssSubscriptionRpcs.requests),
	scopeMapFromRpcGroup(IntegrationRequestRpcs.requests),
	scopeMapFromRpcGroup(ChatSyncRpcs.requests),
)

/**
 * Alias — currently identical to RPC_SCOPE_MAP.
 * When HTTP API annotations are added, this can be extended
 * to include HTTP endpoint scopes as well.
 */
export const ALL_SCOPE_MAP: ScopeMap = RPC_SCOPE_MAP
