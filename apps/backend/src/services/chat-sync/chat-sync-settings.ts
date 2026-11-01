/**
 * A channel link's `settings`: the outbound identity (post as each Hazel author, or as the bot)
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
	enabled: false,
	strategy: "webhook",
	providers: {},
})

/** A new link's settings: the caller's, with an outbound identity (off) when they gave none. */
export const normalizeChannelLinkSettings = (settings: Settings): Record<string, unknown> => ({
	...settings,
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

/** Whether the link posts as each Hazel author (rather than as the bot). */
export const isWebhookStrategyEnabled = (identity: ChatSyncChannelLink.OutboundIdentitySettings) =>
	identity.enabled && identity.strategy === "webhook"

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
	const current = rawOutboundIdentity(settings) ?? defaultOutboundIdentity()
	const providers =
		current.providers !== null && typeof current.providers === "object"
			? (current.providers as Record<string, unknown>)
			: {}
	return {
		...settings,
		outboundIdentity: {
			...current,
			enabled: identity.enabled,
			strategy: identity.strategy,
			providers: { ...providers, ...identity.providers },
		},
		...(permission ? { webhookPermission: permission } : {}),
	}
}
