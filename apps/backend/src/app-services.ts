/**
 * The application services every runtime shares: the repositories, the policies and the
 * platform-independent services. Still requires the platform services (`Database`,
 * `Persistence`, `RateLimiter`, `BotGatewayTransport`) from the entry point.
 *
 * Apart from `app.ts` (the routes) so the Durable Objects (`worker/objects/handlers.ts`) reach
 * these layers without the HTTP app's modules: the routes, the HttpApi, Hazel's sign-in.
 */
import {
	AttachmentRepo,
	BotCommandRepo,
	BotInstallationRepo,
	BotRepo,
	ChannelMemberRepo,
	ChannelRepo,
	ChannelSectionRepo,
	ChatSyncChannelLinkRepo,
	ChatSyncConnectionRepo,
	ConnectInviteRepo,
	CustomEmojiRepo,
	InvitationRepo,
	ChannelWebhookRepo,
	GitHubSubscriptionRepo,
	IntegrationConnectionRepo,
	IntegrationTokenRepo,
	MessageReactionRepo,
	MessageRepo,
	NotificationRepo,
	OrganizationMemberRepo,
	OrganizationRepo,
	PinnedMessageRepo,
	RssSubscriptionRepo,
	TypingIndicatorRepo,
	UserRepo,
} from "@hazel/backend-core"
import { Discord, GitHub, Slack } from "@hazel/integrations"
import { Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { AttachmentPolicy } from "./policies/attachment-policy"
import { BotPolicy } from "./policies/bot-policy"
import { ChannelMemberPolicy } from "./policies/channel-member-policy"
import { ChannelPolicy } from "./policies/channel-policy"
import { ChannelSectionPolicy } from "./policies/channel-section-policy"
import { ChannelWebhookPolicy } from "./policies/channel-webhook-policy"
import { CustomEmojiPolicy } from "./policies/custom-emoji-policy"
import { GitHubSubscriptionPolicy } from "./policies/github-subscription-policy"
import { IntegrationConnectionPolicy } from "./policies/integration-connection-policy"
import { InvitationPolicy } from "./policies/invitation-policy"
import { MessagePolicy } from "./policies/message-policy"
import { MessageReactionPolicy } from "./policies/message-reaction-policy"
import { NotificationPolicy } from "./policies/notification-policy"
import { OrganizationMemberPolicy } from "./policies/organization-member-policy"
import { OrganizationPolicy } from "./policies/organization-policy"
import { PinnedMessagePolicy } from "./policies/pinned-message-policy"
import { RssSubscriptionPolicy } from "./policies/rss-subscription-policy"
import { TypingIndicatorPolicy } from "./policies/typing-indicator-policy"
import { UserPolicy } from "./policies/user-policy"
import { UserPresenceStatusPolicy } from "./policies/user-presence-status-policy"
import { BotGatewayService } from "./services/bot-gateway-service"
import { ChannelAccessSyncService } from "./services/channel-access-sync"
import { ChannelViewers } from "./services/channel-viewers"
import { ChatSyncAttributionReconciler } from "./services/chat-sync/chat-sync-attribution-reconciler"
import { ChatSyncInstallations } from "./services/chat-sync/chat-sync-installations"
import { HtmlRenders } from "./services/html-renders"
import { IntegrationTokenService } from "./services/integration-token-service"
import { IntegrationBotService } from "./services/integrations/integration-bot-service"
import { Invitations } from "./services/invitations"
import { OAuthProviderRegistry } from "./services/oauth"
import { OAuthBearerAuth } from "./services/oauth-bearer-auth"
import { ObjectStorage } from "./services/object-storage"
import { OrgResolver } from "./services/org-resolver"
import { WebhookBotService } from "./services/webhook-bot-service"

export const RepoLive = Layer.mergeAll(
	MessageRepo.layer,
	ChannelRepo.layer,
	ChannelMemberRepo.layer,
	ChannelSectionRepo.layer,
	ChatSyncConnectionRepo.layer,
	ChatSyncChannelLinkRepo.layer,
	ConnectInviteRepo.layer,
	UserRepo.layer,
	OrganizationRepo.layer,
	OrganizationMemberRepo.layer,
	PinnedMessageRepo.layer,
	AttachmentRepo.layer,
	NotificationRepo.layer,
	TypingIndicatorRepo.layer,
	MessageReactionRepo.layer,
	IntegrationConnectionRepo.layer,
	IntegrationTokenRepo.layer,
	ChannelWebhookRepo.layer,
	GitHubSubscriptionRepo.layer,
	RssSubscriptionRepo.layer,
	BotRepo.layer,
	BotCommandRepo.layer,
	BotInstallationRepo.layer,
	CustomEmojiRepo.layer,
	InvitationRepo.layer,
)

export const PolicyLive = Layer.mergeAll(
	OrgResolver.layer,
	ChannelViewers.layer,
	OrganizationPolicy.layer,
	ChannelPolicy.layer,
	ChannelSectionPolicy.layer,
	MessagePolicy.layer,
	OrganizationMemberPolicy.layer,
	ChannelMemberPolicy.layer,
	MessageReactionPolicy.layer,
	UserPolicy.layer,
	AttachmentPolicy.layer,
	PinnedMessagePolicy.layer,
	TypingIndicatorPolicy.layer,
	NotificationPolicy.layer,
	UserPresenceStatusPolicy.layer,
	IntegrationConnectionPolicy.layer,
	ChannelWebhookPolicy.layer,
	GitHubSubscriptionPolicy.layer,
	RssSubscriptionPolicy.layer,
	BotPolicy.layer,
	CustomEmojiPolicy.layer,
	InvitationPolicy.layer,
)

/** Services shared by every runtime. */
export const AppServicesLive = Layer.mergeAll(
	RepoLive,
	PolicyLive,
	ObjectStorage.layer,
	HtmlRenders.layer,
	GitHub.GitHubAppJWTService.layer,
	GitHub.GitHubApiClient.layer,
	Discord.DiscordApiClient.layer,
	Slack.SlackApiClient.layer,
	ChatSyncInstallations.layer,
	IntegrationTokenService.layer,
	OAuthProviderRegistry.layer,
	IntegrationBotService.layer,
	ChatSyncAttributionReconciler.layer,
	BotGatewayService.layer,
	WebhookBotService.layer,
	ChannelAccessSyncService.layer,
	Invitations.layer,
	OAuthBearerAuth.layer,
).pipe(Layer.provideMerge(FetchHttpClient.layer))
