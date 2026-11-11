/** Discord's chat-sync facts: limits, mention syntax, and its webhook identity in link settings. */
import { ChatSyncChannelLink } from "@hazel/domain/models"
import { Option, Schema } from "effect"
import { isWebhookStrategyEnabled, outboundIdentityOf } from "../../chat-sync-settings"
import type { ChatSyncProviderDefinition } from "../../provider"

type Settings = Record<string, unknown> | null | undefined

const decodeWebhookConfig = Schema.decodeUnknownOption(
	ChatSyncChannelLink.DiscordWebhookOutboundIdentityConfig,
)

/** The webhook the link posts through as each author, once provisioned. */
export const discordWebhookConfigOf = (
	identity: ChatSyncChannelLink.OutboundIdentitySettings,
): Option.Option<ChatSyncChannelLink.DiscordWebhookOutboundIdentityConfig> => {
	const config = (identity.providers as Record<string, unknown>)["discord"]
	if (config === null || typeof config !== "object") return Option.none()
	if ((config as { kind?: unknown }).kind !== "discord.webhook") return Option.none()
	return decodeWebhookConfig(config)
}

export const discord: ChatSyncProviderDefinition = {
	id: "discord",
	displayName: "Discord",
	// One bot for every guild; the org's connection is the user who added it.
	workspaceIsInstall: false,
	maxMessageLength: 2000,
	maxThreadNameLength: 100,
	threadChannelId: (_parent, externalThreadId) => externalThreadId,
	mention: (externalUserId) => `<@${externalUserId}>`,
	// `<@123>`, and the legacy nickname form `<@!123>`.
	mentionPattern: /<@!?(\d{17,30})>/g,
	// Discord names unicode reactions by the emoji itself, and custom ones `name:id`.
	emojiToProvider: (emoji) => emoji,
	emojiFromProvider: (emoji) => emoji,
	isOwnEcho: (settings: Settings, externalWebhookId) => {
		if (externalWebhookId === null) return false
		const identity = outboundIdentityOf(settings)
		if (!isWebhookStrategyEnabled(identity)) return false
		const config = discordWebhookConfigOf(identity)
		return Option.isSome(config) && config.value.webhookId === externalWebhookId
	},
}
