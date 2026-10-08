import { ChatSyncChannelLink, ChatSyncConnection, ChannelWebhook, ConnectInvite } from "@hazel/domain/models"
import {
	ChannelWebhookListResponse,
	ChatSyncChannelLinkListResponse,
	ChatSyncConnectionListResponse,
	ConnectInviteListResponse,
} from "@hazel/domain/rpc"
import type { Dataset } from "../dataset.ts"
import { stableId } from "../ids.ts"
import { defaultIds } from "./default.ts"

/** Canned RPC responses for the `integrations` dataset (chat sync, connect invites, webhooks). */

const { orgId, user, channel } = defaultIds

export const chatSyncIds = {
	community: stableId("sync-connection:community"),
	friends: stableId("sync-connection:friends"),
	legacy: stableId("sync-connection:legacy"),
}

export const LONG_GUILD_NAME = "Open Source Friends and Contributors Community Server With A Long Name"

export const connectionRows = (now: Date) => {
	const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000)
	return [
		{ key: "community", name: "Hazel Community", status: "active", synced: daysAgo(0.1), error: null },
		{ key: "friends", name: LONG_GUILD_NAME, status: "paused", synced: daysAgo(3), error: null },
		{
			key: "legacy",
			name: "Legacy Guild",
			status: "error",
			synced: null,
			error: "Missing permissions: the bot can no longer read messages in this server.",
		},
	].map((row, index) =>
		ChatSyncConnection.Schema.make({
			id: chatSyncIds[row.key as keyof typeof chatSyncIds],
			organizationId: orgId,
			integrationConnectionId: null,
			provider: "discord",
			externalWorkspaceId: `91827364550012${index}`,
			externalWorkspaceName: row.name,
			status: row.status,
			settings: null,
			metadata: null,
			errorMessage: row.error,
			lastSyncedAt: row.synced,
			createdBy: user("ada"),
			createdAt: daysAgo(30),
			updatedAt: null,
			deletedAt: null,
		} as never),
	)
}

export const channelLinkRows = (now: Date) =>
	[
		{ key: "general", hazel: channel("general"), name: "general", direction: "both", active: true, webhook: "allowed" },
		{ key: "design", hazel: channel("design"), name: "design-feedback", direction: "hazel_to_external", active: false, webhook: "denied" },
		{ key: "eng", hazel: channel("engineering"), name: "engineering-announcements-and-release-notes", direction: "external_to_hazel", active: true, webhook: null },
	].map((link, index) =>
		ChatSyncChannelLink.Schema.make({
			id: stableId(`sync-link:${link.key}`),
			syncConnectionId: chatSyncIds.community,
			hazelChannelId: link.hazel,
			externalChannelId: `55500011122233${index}`,
			externalChannelName: link.name,
			direction: link.direction,
			isActive: link.active,
			settings: link.webhook ? { webhookPermission: { status: link.webhook } } : null,
			lastSyncedAt: now,
			createdAt: now,
			updatedAt: null,
			deletedAt: null,
		} as never),
	)

const invite = (
	now: Date,
	key: string,
	fields: { host: string; status: string; days: number; target?: string; channelKey?: "design" | "general" },
) =>
	ConnectInvite.Schema.make({
		id: stableId(`connect-invite:${key}`),
		conversationId: stableId(`connect-conversation:${key}`),
		hostOrganizationId: fields.host,
		hostChannelId: fields.channelKey ? channel(fields.channelKey) : stableId(`channel:${key}:host`),
		targetKind: "slug",
		targetValue: fields.target ?? "hazel",
		guestOrganizationId: null,
		status: fields.status,
		allowGuestMemberAdds: false,
		invitedBy: user("ada"),
		acceptedBy: null,
		acceptedAt: null,
		expiresAt: null,
		createdAt: new Date(now.getTime() - fields.days * 24 * 60 * 60_000),
		updatedAt: null,
		deletedAt: null,
	} as never)

const webhookRows = (now: Date) =>
	[
		{ key: "ci", name: "CI notifications", enabled: true, suffix: "a1b2", used: 0.02 },
		{ key: "alerts", name: "Grafana alerts", enabled: false, suffix: "9f3c", used: null },
		{ key: "openstatus", name: "OpenStatus", enabled: true, suffix: "77de", used: 1 },
	].map((hook) =>
		ChannelWebhook.Schema.make({
			id: stableId(`webhook:${hook.key}`),
			channelId: channel("general"),
			organizationId: orgId,
			botUserId: stableId(`user:webhook:${hook.key}`),
			name: hook.name,
			description: null,
			avatarUrl: null,
			tokenSuffix: hook.suffix,
			isEnabled: hook.enabled,
			createdBy: user("ada"),
			lastUsedAt: hook.used === null ? null : new Date(now.getTime() - hook.used * 24 * 60 * 60_000),
			createdAt: new Date(now.getTime() - 20 * 24 * 60 * 60_000),
			updatedAt: null,
			deletedAt: null,
		} as never),
	)

export const integrationsRpc = (now: Date): Dataset["rpc"] => ({
	"chatSync.connection.list": () => new ChatSyncConnectionListResponse({ data: connectionRows(now) }),
	"chatSync.channelLink.list": (payload) =>
		new ChatSyncChannelLinkListResponse({
			data:
				(payload as { syncConnectionId: string }).syncConnectionId === chatSyncIds.community
					? channelLinkRows(now)
					: [],
		}),
	"connectShare.invite.listIncoming": () =>
		new ConnectInviteListResponse({
			data: [
				invite(now, "acme-ops", { host: stableId("org:acme"), status: "pending", days: 1 }),
				invite(now, "globex-launch", { host: stableId("org:globex"), status: "pending", days: 4 }),
				invite(now, "initech-tps", { host: stableId("org:initech"), status: "declined", days: 21 }),
			],
		}),
	"connectShare.invite.listOutgoing": () =>
		new ConnectInviteListResponse({
			data: [
				invite(now, "design-globex", { host: orgId, status: "pending", days: 2, target: "globex", channelKey: "design" }),
				invite(now, "design-initech", { host: orgId, status: "declined", days: 15, target: "initech", channelKey: "design" }),
			],
		}),
	"channelWebhook.list": (payload) =>
		new ChannelWebhookListResponse({
			data: (payload as { channelId: string }).channelId === channel("general") ? webhookRows(now) : [],
		}),
})
