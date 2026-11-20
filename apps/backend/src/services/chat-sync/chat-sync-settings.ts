/**
 * A channel link's `settings`: the outbound identity (post as each Hazel author, the default, or
 * as the bot once the provider refused the identity)
 * and the permission the provider last reported for it. Pure; the org owns the row, the channel
 * holds a copy (`channel.setChatSyncLinks`). A provider keeps its own identity config under
 * `outboundIdentity.providers.<id>` (`providers/<id>/definition.ts`).
 */
import { ChatSyncChannelLink } from "@hazel/domain/models"
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

export const defaultOutboundIdentity = (): ChatSyncChannelLink.OutboundIdentitySettings => ({
	strategy: "webhook",
	providers: {},
})

/** A new link's settings: the caller's, with the default outbound identity when they gave none. */
/** Link settings key: Discord found the link's channel in its guild (`verifiedInGuild`). */
export const GUILD_VERIFIED = "discordGuildVerified"

/**
 * A new link's settings from the caller. Discord's guild check (`discordGuildVerified`) is dropped:
 * only the client sets it, after it found the channel in the guild, so every new link starts unchecked.
 */
export const normalizeChannelLinkSettings = (settings: Settings): Record<string, unknown> => {
	const { [GUILD_VERIFIED]: _callerClaim, ...rest } = settings ?? {}
	return { ...rest, outboundIdentity: settings?.outboundIdentity ?? defaultOutboundIdentity() }
}

const rawOutboundIdentity = (settings: Settings): Record<string, unknown> | undefined => {
	const raw = settings?.outboundIdentity
	return raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined
}

export const outboundIdentityOf = (settings: Settings): ChatSyncChannelLink.OutboundIdentitySettings => {
	const raw = rawOutboundIdentity(settings)
	if (raw === undefined) return defaultOutboundIdentity()
	return Option.getOrElse(decodeOutboundIdentitySettings(raw), defaultOutboundIdentity)
}

/** Whether the link posts as each Hazel author (rather than as the bot). */
export const postsAsEachAuthor = (identity: ChatSyncChannelLink.OutboundIdentitySettings) =>
	identity.strategy === "webhook"

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

/** `settings` with `identity` merged into its outbound identity, and the permission state. */
export const withOutboundIdentity = (
	settings: Settings,
	identity: ChatSyncChannelLink.OutboundIdentitySettings,
	permission?: WebhookPermissionState,
): Record<string, unknown> => {
	// `enabled` predates posting as each author by default; a rewrite drops it.
	const { enabled: _enabled, ...current }: Record<string, unknown> =
		rawOutboundIdentity(settings) ?? defaultOutboundIdentity()
	const providers =
		current.providers !== null && typeof current.providers === "object"
			? (current.providers as Record<string, unknown>)
			: {}
	return {
		...settings,
		outboundIdentity: {
			...current,
			strategy: identity.strategy,
			providers: { ...providers, ...identity.providers },
		},
		...(permission ? { webhookPermission: permission } : {}),
	}
}
