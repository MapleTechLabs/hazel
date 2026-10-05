import { HttpApiScalar } from "effect/http-api"
import { FetchHttpClient, HttpRouter, HttpMiddleware, HttpServerResponse } from "effect/http"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
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
	ChannelWebhookRepo,
	GitHubSubscriptionRepo,
	IntegrationConnectionRepo,
	IntegrationTokenRepo,
	MessageReactionRepo,
	MessageOutboxRepo,
	MessageRepo,
	NotificationRepo,
	OrganizationMemberRepo,
	OrganizationRepo,
	PinnedMessageRepo,
	RssSubscriptionRepo,
	TypingIndicatorRepo,
	UserPresenceStatusRepo,
	UserRepo,
	ClerkSync,
} from "@hazel/backend-core"
import { ClerkClient } from "@hazel/auth"
import { Redis, RedisResultPersistenceLive, S3 } from "@hazel/effect-bun"
import { createTracingLayer } from "@hazel/effect-bun/Telemetry"
import { GitHub } from "@hazel/integrations"
import { Config, ConfigProvider, Effect, Layer, Context } from "effect"
import { HazelApi } from "./api"
import { HttpApiRoutes } from "./http"
import { AttachmentPolicy } from "./policies/attachment-policy"
import { BotPolicy } from "./policies/bot-policy"
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
import { DatabaseLive } from "./services/database"
import { IntegrationTokenService } from "./services/integration-token-service"
import { IntegrationBotService } from "./services/integrations/integration-bot-service"
import { ChatSyncAttributionReconciler } from "./services/chat-sync/chat-sync-attribution-reconciler"
import { DiscordSyncWorkerLayer } from "./services/chat-sync/discord-sync-worker"
import { DiscordGatewayService } from "./services/chat-sync/discord-gateway-service"
import { MessageOutboxDispatcher } from "./services/message-outbox-dispatcher"
import { MessageSideEffectService } from "./services/message-side-effect-service"
import { MockDataGenerator } from "./services/mock-data-generator"
import { OAuthBearerAuth } from "./services/oauth-bearer-auth"
import { OAuthProviderRegistry } from "./services/oauth"
import { RateLimiter } from "./services/rate-limiter"
import { SessionManager } from "./services/session-manager"
import { WebhookBotService } from "./services/webhook-bot-service"
import { BotGatewayService } from "./services/bot-gateway-service"
import { ChannelAccessSyncService } from "./services/channel-access-sync"
import { ConnectConversationService } from "./services/connect-conversation-service"
import { OrgResolver } from "./services/org-resolver"

export { HazelApi }

// Export RPC groups for frontend consumption
export { AuthMiddleware, MessageRpcs, NotificationRpcs } from "@hazel/domain/rpc"

const HealthRouter = HttpRouter.use((router) => router.add("GET", "/health", HttpServerResponse.text("OK")))

const DocsRoute = HttpApiScalar.layer(HazelApi, {
	path: "/docs",
})

// HTTP RPC endpoint
const RpcRoute = RpcServer.layerHttp({
	group: AllRpcs,
	path: "/rpc",
	protocol: "http",
}).pipe(Layer.provide(RpcSerialization.layerNdjson), Layer.provide(RpcServerLive))

const AllRoutes = Layer.mergeAll(HttpApiRoutes, HealthRouter, DocsRoute, RpcRoute).pipe(
	Layer.provide(
		HttpRouter.cors({
			allowedOrigins: [
				"http://localhost:3000",
				"http://localhost:5173",
				"https://app.hazel.sh",
				"tauri://localhost",
				"http://tauri.localhost",
			],
			allowedMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
			credentials: true,
		}),
	),
)

const TracerLive = createTracingLayer("api")

const RepoLive = Layer.mergeAll(
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
	MessageOutboxRepo.layer,
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
)

const PolicyLive = Layer.mergeAll(
	OrgResolver.layer,
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
)

// ResultPersistence layer for session caching (uses Redis backing)
const PersistenceLive = RedisResultPersistenceLive.pipe(Layer.provide(Redis.Default))

const MainLive = Layer.mergeAll(
	RepoLive,
	PolicyLive,
	MockDataGenerator.layer,
	ClerkClient.layer,
	ClerkSync.layer,
	DatabaseLive,
	S3.Default,
	Redis.Default,
	PersistenceLive,
	GitHub.GitHubAppJWTService.layer,
	GitHub.GitHubApiClient.layer,
	IntegrationTokenService.layer,
	OAuthProviderRegistry.layer,
	IntegrationBotService.layer,
	ChatSyncAttributionReconciler.layer,
	DiscordSyncWorkerLayer,
	DiscordGatewayService.layer,
	MessageSideEffectService.layer,
	MessageOutboxDispatcher.layer,
	BotGatewayService.layer,
	WebhookBotService.layer,
	ChannelAccessSyncService.layer,
	ConnectConversationService.layer,
	RateLimiter.layer,
	// SessionManager.layer includes BackendAuth.layer via dependencies
	SessionManager.layer,
	OAuthBearerAuth.layer,
).pipe(
	Layer.provideMerge(FetchHttpClient.layer),
	Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))),
)

const ServerLayer = HttpRouter.serve(AllRoutes).pipe(
	Layer.provide(
		Layer.succeed(
			HttpMiddleware.TracerDisabledWhen,
			(request) => request.url === "/health" || request.method === "OPTIONS",
		),
	),
	Layer.provide(MainLive),
	Layer.provide(TracerLive),
	Layer.provide(
		AuthorizationLive.pipe(
			// SessionManager.layer includes BackendAuth and UserRepo via dependencies
			Layer.provideMerge(SessionManager.layer),
			Layer.provideMerge(PersistenceLive),
			Layer.provideMerge(Redis.Default),
			Layer.provideMerge(DatabaseLive),
		),
	),
	Layer.provide(
		BunHttpServer.layerConfig(
			Config.all({
				port: Config.Number("PORT").pipe(Config.withDefault(3003)),
				idleTimeout: Config.succeed(120),
			}),
		),
	),
)

// The `as never` cast is required because ChatSyncCoreWorkerMake (in chat-sync-core-worker.ts)
// is explicitly typed as Effect<..., unknown, unknown> to break a circular type dependency.
// Those `unknown` types propagate through DiscordSyncWorkerLayer -> ServiceLive -> MainLive -> ServerLayer,
// causing TypeScript to collapse the layer's type parameters to `unknown`.
// All actual dependencies are wired correctly at runtime.
ServerLayer.pipe(Layer.launch as never, BunRuntime.runMain)
