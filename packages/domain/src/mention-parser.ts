import type { UserId } from "@hazel/schema"

export interface MentionAnalysis {
	userMentions: UserId[]
	hasChannelMention: boolean
	hasHereMention: boolean
}

/**
 * Parse mentions from message content.
 *
 * Mention patterns:
 * - User mentions: @[userId:UUID]
 * - Channel broadcast: @[directive:channel]
 * - Here broadcast: @[directive:here]
 */
export function parseMentions(content: string): MentionAnalysis {
	const userMentions: UserId[] = []
	let hasChannelMention = false
	let hasHereMention = false

	const pattern = /@\[(userId|directive):([^\]]+)\]/g
	const matches = content.matchAll(pattern)

	for (const match of matches) {
		const prefix = match[1]
		const value = match[2]

		if (prefix === "userId" && value) {
			userMentions.push(value as UserId)
		} else if (prefix === "directive") {
			if (value === "channel") hasChannelMention = true
			if (value === "here") hasHereMention = true
		}
	}

	return { userMentions, hasChannelMention, hasHereMention }
}
