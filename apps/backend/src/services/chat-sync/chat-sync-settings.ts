/**
 * A channel link's `settings`: the outbound identity (post as a Discord webhook per Hazel author,
 * or as the bot) and the webhook permission Discord last reported. Pure; the org owns the row,
 * the channel holds a copy (`channel.setChatSyncLinks`).
 */
import { ChatSyncChannelLink } from "@hazel/domain/models"
import type { ExternalWebhookId } from "@hazel/schema"
import { Option, Schema } from "effect"

type Settings = Record<string, unknown> | null | undefined

export type WebhookPermissionStatus = "unknown" | "allowed" | "denied"

export interface WebhookPermissionState {
	readonly status: WebhookPermissionStatus
	readonly checkedAt: string
	readonly reason?: string
}

const decodeOutboundIdentitySettings = Schema.decodeUnknownOption(
	ChatSyncChannelLink.OutboundIdentitySettings,
)
const decodeDiscordWebhookConfig = Schema.decodeUnknownOption(
	ChatSyncChannelLink.DiscordWebhookOutboundIdentityConfig,
)

export const defaultOutboundIdentity = (): ChatSyncChannelLink.OutboundIdentitySettings => ({
	enabled: false,
	strategy: "webhook",
	providers: {},
})

/** A new link's settings: the caller's, with an outbound identity (off) when they gave none. */
export const normalizeChannelLinkSettings = (settings: Settings): Record<string, unknown> => ({
	...(settings ?? {}),
	outboundIdentity: settings?.outboundIdentity ?? defaultOutboundIdentity(),
})

const rawOutboundIdentity = (settings: Settings): Record<string, unknown> | undefined => {
	const raw = settings?.outboundIdentity
	return raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined
}

export const outboundIdentityOf = (settings: Settings): ChatSyncChannelLink.OutboundIdentitySettings => {
	const raw = rawOutboundIdentity(settings)
	if (raw === undefined) return defaultOutboundIdentity()
	return Option.getOrElse(decodeOutboundIdentitySettings(raw), defaultOutboundIdentity)
}

export const isWebhookStrategyEnabled = (identity: ChatSyncChannelLink.OutboundIdentitySettings) =>
	identity.enabled && identity.strategy === "webhook"

export const discordWebhookConfigOf = (
	identity: ChatSyncChannelLink.OutboundIdentitySettings,
): Option.Option<ChatSyncChannelLink.DiscordWebhookOutboundIdentityConfig> => {
	const config = (identity.providers as Record<string, unknown>)["discord"]
	if (config === null || typeof config !== "object") return Option.none()
	if ((config as { kind?: unknown }).kind !== "discord.webhook") return Option.none()
	return decodeDiscordWebhookConfig(config)
}

export const webhookPermissionOf = (settings: Settings): WebhookPermissionState | undefined => {
	const raw = settings?.webhookPermission
	if (raw === null || typeof raw !== "object") return undefined
	const { status, checkedAt, reason } = raw as { status?: unknown; checkedAt?: unknown; reason?: unknown }
	if (status !== "allowed" && status !== "denied" && status !== "unknown") return undefined
	return {
		status,
		checkedAt:
			typeof checkedAt === "string" && checkedAt.trim().length > 0
				? checkedAt
				: new Date().toISOString(),
		...(typeof reason === "string" && reason.trim().length > 0 ? { reason } : {}),
	}
}

export const webhookPermission = (
	status: WebhookPermissionStatus,
	reason?: string,
): WebhookPermissionState => ({
	status,
	checkedAt: new Date().toISOString(),
	...(reason ? { reason } : {}),
})

/**
 * A message the link's own webhook posted: Hazel's outbound echo coming back through the
 * gateway, to be ignored.
 */
export const isOwnWebhookOrigin = (
	provider: string,
	settings: Settings,
	externalWebhookId: ExternalWebhookId | null,
): boolean => {
	if (externalWebhookId === null || provider !== "discord") return false
	const identity = outboundIdentityOf(settings)
	if (!isWebhookStrategyEnabled(identity)) return false
	const config = discordWebhookConfigOf(identity)
	return Option.isSome(config) && config.value.webhookId === externalWebhookId
}

/** `settings` with `identity` merged into its outbound identity, and the permission state. */
export const withOutboundIdentity = (
	settings: Settings,
	identity: ChatSyncChannelLink.OutboundIdentitySettings,
	permission?: WebhookPermissionState,
): Record<string, unknown> => {
	const current = rawOutboundIdentity(settings) ?? defaultOutboundIdentity()
	const providers =
		current.providers !== null && typeof current.providers === "object"
			? (current.providers as Record<string, unknown>)
			: {}
	return {
		...(settings ?? {}),
		outboundIdentity: {
			...current,
			enabled: identity.enabled,
			strategy: identity.strategy,
			providers: { ...providers, ...identity.providers },
		},
		...(permission ? { webhookPermission: permission } : {}),
	}
}
