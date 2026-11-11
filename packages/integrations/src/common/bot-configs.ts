/**
 * Integration provider types for OAuth-based integrations.
 */
export type IntegrationProvider = "linear" | "github" | "figma" | "notion" | "discord" | "craft" | "t3code"

/**
 * Bot configuration for integration providers.
 * Used for displaying bot info in the UI and creating bot users.
 */
export interface IntegrationBotConfig {
	/** Bot display name */
	name: string
	/** Bot avatar URL (Brandfetch CDN) */
	avatarUrl: string
	/** Bot ID prefix for UI identification */
	botId: string
}

/**
 * Shared bot configurations for OAuth integration providers.
 * Single source of truth for bot display info.
 */
export const INTEGRATION_BOT_CONFIGS: Record<IntegrationProvider, IntegrationBotConfig> = {
	linear: {
		name: "Linear",
		avatarUrl: "https://cdn.brandfetch.io/linear.app/w/64/h/64/theme/dark/icon?token=1id0IQ-4i8Z46-n-DfQ",
		botId: "bot-linear",
	},
	github: {
		name: "GitHub",
		avatarUrl: "https://cdn.brandfetch.io/github.com/w/64/h/64/theme/dark/icon?token=1id0IQ-4i8Z46-n-DfQ",
		botId: "bot-github",
	},
	figma: {
		name: "Figma",
		avatarUrl: "https://cdn.brandfetch.io/figma.com/w/64/h/64/theme/dark/icon?token=1id0IQ-4i8Z46-n-DfQ",
		botId: "bot-figma",
	},
	notion: {
		name: "Notion",
		avatarUrl: "https://cdn.brandfetch.io/notion.so/w/64/h/64/theme/dark/icon?token=1id0IQ-4i8Z46-n-DfQ",
		botId: "bot-notion",
	},
	discord: {
		name: "Discord",
		avatarUrl:
			"https://cdn.brandfetch.io/discord.com/w/64/h/64/theme/dark/icon?token=1id0IQ-4i8Z46-n-DfQ",
		botId: "bot-discord",
	},
	craft: {
		name: "Craft",
		avatarUrl: "https://cdn.brandfetch.io/craft.do/w/64/h/64/theme/dark/icon?token=1id0IQ-4i8Z46-n-DfQ",
		botId: "bot-craft",
	},
	t3code: {
		name: "T3 Code",
		avatarUrl: "https://cdn.brandfetch.io/t3.chat/w/64/h/64/theme/dark/icon?token=1id0IQ-4i8Z46-n-DfQ",
		botId: "bot-t3code",
	},
}

/**
 * Webhook provider types (non-OAuth integrations)
 */
export type WebhookProvider = "openstatus" | "railway" | "rss" | "maple"

/**
 * Bot configurations for webhook-based integrations.
 * These don't require OAuth but still need bot users for posting messages.
 */
export const WEBHOOK_BOT_CONFIGS: Record<WebhookProvider, IntegrationBotConfig> = {
	openstatus: {
		name: "OpenStatus",
		avatarUrl:
			"https://cdn.brandfetch.io/openstatus.dev/w/64/h/64/theme/dark/icon?token=1id0IQ-4i8Z46-n-DfQ",
		botId: "bot-openstatus",
	},
	railway: {
		name: "Railway",
		avatarUrl:
			"https://cdn.brandfetch.io/railway.com/w/64/h/64/theme/dark/icon?token=1id0IQ-4i8Z46-n-DfQ",
		botId: "bot-railway",
	},
	rss: {
		name: "RSS",
		avatarUrl: "https://cdn.brandfetch.io/rss.com/w/64/h/64/theme/dark/icon?token=1id0IQ-4i8Z46-n-DfQ",
		botId: "bot-rss",
	},
	maple: {
		name: "Maple",
		avatarUrl: "https://cdn.brandfetch.io/maple.dev/w/64/h/64/theme/dark/icon?token=1id0IQ-4i8Z46-n-DfQ",
		botId: "bot-maple",
	},
}

/**
 * Get bot config for a specific OAuth provider
 */
export const getBotConfig = (provider: IntegrationProvider): IntegrationBotConfig =>
	INTEGRATION_BOT_CONFIGS[provider]

/**
 * Get bot config for a webhook provider
 */
export const getWebhookBotConfig = (provider: WebhookProvider): IntegrationBotConfig =>
	WEBHOOK_BOT_CONFIGS[provider]
