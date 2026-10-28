/**
 * The backend's runtime-agnostic application: routes plus every service that does not depend on
 * the host platform. The api Worker (`worker.ts`) and the objects provide the platform layer: `Database`, `Persistence`, `RateLimiter`, `BotGatewayTransport`, the tracer and
 * the ConfigProvider.
 */
import { HttpApiScalar } from "effect/http-api"
import { FetchHttpClient, HttpRouter, HttpServerResponse } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
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
	ChatSyncEventReceiptRepo,
	ChatSyncMessageLinkRepo,
	ConnectConversationChannelRepo,
	ConnectConversationRepo,
	ConnectInviteRepo,
	ConnectParticipantRepo,
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
	UserPresenceStatusRepo,
	UserRepo,
} from "@hazel/backend-core"
import { GitHub } from "@hazel/integrations"
import { Layer } from "effect"
import { HazelApi } from "./api"
import { HttpApiRoutes } from "./http"
import { ServerFailureReporterLive } from "./lib/error-reporter"
import { AttachmentPolicy } from "./policies/attachment-policy"
import { BotPolicy } from "./policies/bot-policy"
import { InvitationPolicy } from "./policies/invitation-policy"
import { Invitations } from "./services/invitations"
import { ChannelMemberPolicy } from "./policies/channel-member-policy"
import { ChannelPolicy } from "./policies/channel-policy"
import { ChannelSectionPolicy } from "./policies/channel-section-policy"
import { CustomEmojiPolicy } from "./policies/custom-emoji-policy"
import { ChannelWebhookPolicy } from "./policies/channel-webhook-policy"
import { GitHubSubscriptionPolicy } from "./policies/github-subscription-policy"
import { RssSubscriptionPolicy } from "./policies/rss-subscription-policy"
import { IntegrationConnectionPolicy } from "./policies/integration-connection-policy"
import { MessagePolicy } from "./policies/message-policy"
import { MessageReactionPolicy } from "./policies/message-reaction-policy"
import { NotificationPolicy } from "./policies/notification-policy"
import { OrganizationMemberPolicy } from "./policies/organization-member-policy"
import { OrganizationPolicy } from "./policies/organization-policy"
import { PinnedMessagePolicy } from "./policies/pinned-message-policy"
import { TypingIndicatorPolicy } from "./policies/typing-indicator-policy"
import { UserPolicy } from "./policies/user-policy"
import { UserPresenceStatusPolicy } from "./policies/user-presence-status-policy"
import { AllRpcs, RpcServerLive } from "./rpc/server"
import { AuthorizationLive } from "./services/auth"
import { IntegrationTokenService } from "./services/integration-token-service"
import { IntegrationBotService } from "./services/integrations/integration-bot-service"
import { ChatSyncAttributionReconciler } from "./services/chat-sync/chat-sync-attribution-reconciler"
import { OAuthBearerAuth } from "./services/oauth-bearer-auth"
import { ObjectStorage } from "./services/object-storage"
import { OAuthProviderRegistry } from "./services/oauth"
import { HazelAuthInstance, HazelAuthRoutes, HazelAuthServicesLive } from "./services/hazel-auth"
import { HazelSession } from "./services/hazel-session"
import { WebhookBotService } from "./services/webhook-bot-service"
import { BotGatewayService } from "./services/bot-gateway-service"
import { ChannelAccessSyncService } from "./services/channel-access-sync"
import { OrgResolver } from "./services/org-resolver"
import { ChannelViewers } from "./services/channel-viewers"

export { HazelApi }

// Export RPC groups for frontend consumption
export { AuthMiddleware, MessageRpcs, NotificationRpcs } from "@hazel/domain/rpc"

export const HealthRouter = HttpRouter.use((router) =>
	router.add("GET", "/health", HttpServerResponse.text("OK")),
)

const DocsRoute = HttpApiScalar.layer(HazelApi, {
	path: "/docs",
})

/**
 * The routes, with the RPC endpoint served by `rpcServer` (the api Worker's router into the
 * objects, `RoutedRpcServerLive`; typed by the in-process `RpcServerLive`). `extra` routes join
 * the same CORS and failure reporting (the Worker's `/sync` upgrade).
 */
export const makeRoutes = <E, R, EX = never, RX = never>(
	rpcServer: Layer.Layer<Layer.Success<typeof RpcServerLive>, E, R>,
	extra: Layer.Layer<never, EX, RX> = Layer.empty as Layer.Layer<never, EX, RX>,
) =>
	Layer.mergeAll(
		HttpApiRoutes,
		HealthRouter,
		DocsRoute,
		RpcServer.layerHttp({
			group: AllRpcs,
			path: "/rpc",
			protocol: "http",
		}).pipe(Layer.provide(RpcSerialization.layerNdjson), Layer.provide(rpcServer)),
		HazelAuthRoutes,
		extra,
	).pipe(
		Layer.provide(
			HttpRouter.cors({
				allowedOrigins: [
					"http://localhost:3000",
					"http://localhost:3100",
					"http://localhost:5173",
					"https://app.hazel.sh",
					"tauri://localhost",
					"http://tauri.localhost",
				],
				allowedMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
				credentials: true,
			}),
		),
		// RpcServer and HttpApiBuilder report failed requests here; server failures get logged.
		Layer.provide(ServerFailureReporterLive),
	)

/**
 * Hazel's own sign-in: the configured instance, its auth services, and the session lookup
 * the RPC and HttpApi middleware use. Inert until `AUTH_GITHUB_CLIENT_ID` is set. Needs the
 * directory's `SqlClient` from the entry point.
 */
export const HazelAuthLive = HazelSession.layer.pipe(
	Layer.provideMerge(HazelAuthServicesLive),
	Layer.provideMerge(HazelAuthInstance.layer),
)

export const RepoLive = Layer.mergeAll(
	MessageRepo.layer,
	ChannelRepo.layer,
	ChannelMemberRepo.layer,
	ChannelSectionRepo.layer,
	ChatSyncConnectionRepo.layer,
	ChatSyncChannelLinkRepo.layer,
	ChatSyncMessageLinkRepo.layer,
	ChatSyncEventReceiptRepo.layer,
	ConnectConversationRepo.layer,
	ConnectConversationChannelRepo.layer,
	ConnectInviteRepo.layer,
	ConnectParticipantRepo.layer,
	UserRepo.layer,
	OrganizationRepo.layer,
	OrganizationMemberRepo.layer,
	PinnedMessageRepo.layer,
	AttachmentRepo.layer,
	NotificationRepo.layer,
	TypingIndicatorRepo.layer,
	MessageReactionRepo.layer,
	UserPresenceStatusRepo.layer,
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

/**
 * Services shared by every runtime. Still requires the platform services (`Database`,
 * `Persistence`, `RateLimiter`, `BotGatewayTransport`) from the entry point.
 */
export const AppServicesLive = Layer.mergeAll(
	RepoLive,
	PolicyLive,
	ObjectStorage.layer,
	GitHub.GitHubAppJWTService.layer,
	GitHub.GitHubApiClient.layer,
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

/**
 * `CurrentUser` resolution for authenticated routes, and Hazel's sign-in services. Only the
 * HTTP entry points build this; the Durable Objects never authenticate. Requires `Database`
 * and the auth SQL connection from the platform.
 */
export const AppAuthorizationLive = AuthorizationLive.pipe(Layer.provideMerge(HazelAuthLive))
