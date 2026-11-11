import { ChannelId, ExternalChannelId, SyncChannelLinkId, SyncConnectionId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

export const ChatSyncDirection = S.Literals(["both", "hazel_to_external", "external_to_hazel"])
export type ChatSyncDirection = S.Schema.Type<typeof ChatSyncDirection>

export const ChatSyncOutboundIdentityStrategy = S.Literals(["webhook", "fallback_bot"])
export type ChatSyncOutboundIdentityStrategy = S.Schema.Type<typeof ChatSyncOutboundIdentityStrategy>

export const DiscordWebhookOutboundIdentityConfig = S.Struct({
	kind: S.Literal("discord.webhook"),
	webhookId: S.NonEmptyString,
	webhookToken: S.NonEmptyString,
	defaultAvatarUrl: S.optional(S.NonEmptyString),
})
export type DiscordWebhookOutboundIdentityConfig = S.Schema.Type<typeof DiscordWebhookOutboundIdentityConfig>

export const SlackWebhookOutboundIdentityConfig = S.Struct({
	kind: S.Literal("slack.webhook"),
	webhookUrl: S.NonEmptyString,
	defaultIconUrl: S.optional(S.NonEmptyString),
})
export type SlackWebhookOutboundIdentityConfig = S.Schema.Type<typeof SlackWebhookOutboundIdentityConfig>

export const ProviderOutboundConfig = S.Union([
	DiscordWebhookOutboundIdentityConfig,
	SlackWebhookOutboundIdentityConfig,
	S.Struct({
		kind: S.NonEmptyString,
	}),
])
export type ProviderOutboundConfig = S.Schema.Type<typeof ProviderOutboundConfig>

export const OutboundIdentityProviders = S.Record(S.String, ProviderOutboundConfig)

export const OutboundIdentitySettings = S.Struct({
	enabled: S.Boolean,
	strategy: ChatSyncOutboundIdentityStrategy,
	providers: OutboundIdentityProviders,
})
export type OutboundIdentitySettings = S.Schema.Type<typeof OutboundIdentitySettings>

class Model extends M.Class<Model>("ChatSyncChannelLink")({
	id: M.Generated(SyncChannelLinkId),
	syncConnectionId: SyncConnectionId,
	hazelChannelId: ChannelId,
	externalChannelId: ExternalChannelId,
	externalChannelName: S.NullOr(S.String),
	direction: ChatSyncDirection,
	isActive: S.Boolean,
	settings: S.NullOr(S.Record(S.String, S.Unknown)),
	lastSyncedAt: S.NullOr(JsonDate),
	createdAt: M.Generated(JsonDate),
	updatedAt: M.Generated(S.NullOr(JsonDate)),
	deletedAt: M.GeneratedByApp(S.NullOr(JsonDate)),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
