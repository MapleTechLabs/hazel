import type { IntegrationConnection } from "@hazel/domain/models"

/**
 * Bot data interface for avatar resolution
 */
export interface BotAvatarData {
	user?: { avatarUrl?: string | null } | null
	allowedIntegrations?: readonly IntegrationConnection.IntegrationProvider[] | null
}

/** A bot's avatar: its machine user's `avatarUrl`, or `null` for the robot icon fallback. */
export const resolveBotAvatarUrl = (bot: BotAvatarData): string | null => bot.user?.avatarUrl || null
