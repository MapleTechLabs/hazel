import type { UserGroupId, UserId } from "@hazel/schema"

export interface MentionAnalysis {
	userMentions: UserId[]
	/** `@[group:…]`: user groups (Discord's mentionable roles), each mentioning its members. */
	groupMentions: UserGroupId[]
	hasChannelMention: boolean
	hasHereMention: boolean
}

/**
 * Parse mentions from message content.
 *
 * Mention patterns:
 * - User mentions: @[userId:UUID]
 * - Group mentions: @[group:UUID]
 * - Channel broadcast: @[directive:channel]
 * - Here broadcast: @[directive:here]
 */
export function parseMentions(content: string): MentionAnalysis {
	const userMentions: UserId[] = []
	const groupMentions: UserGroupId[] = []
	let hasChannelMention = false
	let hasHereMention = false

	const pattern = /@\[(userId|group|directive):([^\]]+)\]/g
	const matches = content.matchAll(pattern)

	for (const match of matches) {
		const prefix = match[1]
		const value = match[2]

		if (prefix === "userId" && value) {
			userMentions.push(value as UserId)
		} else if (prefix === "group" && value) {
			if (!groupMentions.includes(value as UserGroupId)) groupMentions.push(value as UserGroupId)
		} else if (prefix === "directive") {
			if (value === "channel") hasChannelMention = true
			if (value === "here") hasHereMention = true
		}
	}

	return { userMentions, groupMentions, hasChannelMention, hasHereMention }
}
