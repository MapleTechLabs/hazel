/**
 * The in-app links the palette opens, as the web's routes print them (`web-foldkit/src/route.ts`;
 * `root/palette.test.ts` checks them against it).
 */
import type { ChannelId, CustomerAccountId } from "@hazel/schema"

export const channelHref = (orgSlug: string, channelId: ChannelId) => `/${orgSlug}/chat/${channelId}`

/** A channel opened at one message (`?messageId=`). */
export const messageHref = (orgSlug: string, channelId: ChannelId, messageId: string) =>
	`${channelHref(orgSlug, channelId)}?${new URLSearchParams({ messageId })}`

export const customerHref = (orgSlug: string, accountId: CustomerAccountId, tab: "users" | null) =>
	`/${orgSlug}/customers/${accountId}${tab === null ? "" : `?${new URLSearchParams({ tab })}`}`
