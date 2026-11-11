import {
	ChannelWebhookId,
	ConnectConversationId,
	ConnectInviteId,
	OrganizationId,
	RssSubscriptionId,
} from "@hazel/schema"
import { Schema } from "effect"
import type { Invite, Mount } from "../page/channel-settings/connect/model"
import type { Workspace } from "../page/channel-settings/connect/share-modal"
import type { RssFeed, Webhook } from "../page/channel-settings/integrations/model"
import { organizationId, uuid } from "./pages-fixtures"

/** Fixtures for the channel settings page tests (connect, integrations). */

export const conversationId = Schema.decodeSync(ConnectConversationId)(uuid(20))
export const globexId = Schema.decodeSync(OrganizationId)(uuid(21))
export const initechId = Schema.decodeSync(OrganizationId)(uuid(22))
export const inviteId = Schema.decodeSync(ConnectInviteId)(uuid(23))

export const mountOf = (n: number, org: OrganizationId, role: Mount["role"]): Mount => ({
	id: `mount-${n}`,
	conversationId,
	organizationId: org,
	role,
})

/** This org hosts the conversation and Globex joined as a guest. */
export const hostMount = mountOf(1, organizationId, "host")
export const globexGuestMount = mountOf(2, globexId, "guest")

export const pendingInvite: Invite = {
	id: inviteId,
	targetValue: "globex",
	status: "pending",
	createdAtMs: 0,
}

export const globex: Workspace = { id: globexId, name: "Globex", slug: "globex", logoUrl: null }
export const slugless: Workspace = { id: initechId, name: "Initech", slug: null, logoUrl: null }

export const webhookOf = (n: number, name: string, isEnabled = true): Webhook => ({
	id: Schema.decodeSync(ChannelWebhookId)(uuid(n)),
	name,
	avatarUrl: null,
	tokenSuffix: "a1b2",
	isEnabled,
	lastUsedAtMs: null,
})

export const feedOf = (n: number, title: string): RssFeed => ({
	id: Schema.decodeSync(RssSubscriptionId)(uuid(n)),
	feedUrl: `https://example.com/${n}.xml`,
	feedTitle: title,
	feedIconUrl: null,
	consecutiveErrors: 0,
	isEnabled: true,
	pollingIntervalMinutes: 15,
})
