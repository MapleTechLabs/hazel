import type {
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
} from "../rpc"

// Extract the Rpc union from a group via structural matching on its `requests` property,
// bypassing the `string extends _tag ? never` guard in RpcGroup.Rpcs
type RpcsOf<G> = G extends { readonly requests: ReadonlyMap<string, infer R> } ? R : never
type ActionOf<G> = RpcsOf<G> extends { readonly _tag: infer T extends string } ? T : never

/**
 * Union of all valid RPC action names (e.g. "message.create", "channel.delete").
 * Extracted from the RPC group definitions at the type level.
 */
export type RpcActionName =
	| ActionOf<AttachmentRpcs>
	| ActionOf<BotRpcs>
	| ActionOf<ChannelMemberRpcs>
	| ActionOf<ChannelRpcs>
	| ActionOf<ChannelSectionRpcs>
	| ActionOf<ChannelWebhookRpcs>
	| ActionOf<ChatSyncRpcs>
	| ActionOf<ConnectShareRpcs>
	| ActionOf<CustomEmojiRpcs>
	| ActionOf<GitHubSubscriptionRpcs>
	| ActionOf<IntegrationRequestRpcs>
	| ActionOf<MessageReactionRpcs>
	| ActionOf<MessageRpcs>
	| ActionOf<NotificationRpcs>
	| ActionOf<OrganizationMemberRpcs>
	| ActionOf<OrganizationRpcs>
	| ActionOf<PinnedMessageRpcs>
	| ActionOf<RssSubscriptionRpcs>
	| ActionOf<TypingIndicatorRpcs>
	| ActionOf<UserPresenceStatusRpcs>
	| ActionOf<UserRpcs>

// Compile-time assertion: fails the build if RpcActionName ever regresses to `never`
type _AssertNotNever<T> = [T] extends [never] ? { ERROR: "RpcActionName resolved to never" } : true
declare const _check: _AssertNotNever<RpcActionName>
