import { ChannelWebhookId, RssSubscriptionId } from "@hazel/schema"
import { Schema } from "effect"
import type { RssFeed, Webhook } from "../page/channel-settings/integrations/model"
import { uuid } from "./pages-fixtures"

/** Fixtures for the channel settings page tests (integrations). */

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
