/**
 * Slack's chat-sync facts. A Slack thread is replies in its parent channel, so a thread's link is
 * keyed `<channel>/<parent ts>` (`threadChannelId`); `slackTarget` takes such an id apart.
 */
import { Slack } from "@hazel/integrations"
import type { ChatSyncProviderDefinition } from "../../provider"

/** Where a link's external channel id posts: the channel, and the thread in it, if any. */
export const slackTarget = (externalChannelId: string) => {
	const [channel, threadTs] = externalChannelId.split("/")
	return { channel: channel!, threadTs: threadTs || undefined }
}

export const slack: ChatSyncProviderDefinition = {
	id: "slack",
	displayName: "Slack",
	workspaceIsInstall: true,
	// `markdown_text`'s limit (`text` allows more, but we post markdown).
	maxMessageLength: 12_000,
	// Slack threads have no names; Hazel's thread titles are its own.
	maxThreadNameLength: 100,
	threadChannelId: (parent, threadTs) => `${slackTarget(parent).channel}/${threadTs}`,
	mention: (externalUserId) => `<@${externalUserId}>`,
	mentionPattern: /<@([UW][A-Z0-9]+)>/g,
	emojiToProvider: (emoji) => Slack.unicodeToSlackEmoji(emoji) ?? emoji,
	// A custom workspace emoji has no unicode: keep its `:name:`.
	emojiFromProvider: (name) => Slack.slackEmojiToUnicode(name) ?? `:${name}:`,
	// The events source drops the app's own posts (`app_id`), so nothing reaches the org as one.
	isOwnEcho: () => false,
}
