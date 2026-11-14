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
	PushDeviceRpcs,
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
	scopeMapFromRpcGroup(PushDeviceRpcs.requests),
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
