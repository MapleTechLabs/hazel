import { fixtureBackendUrl } from "../../../config.ts"
import type { Row } from "../../dataset.ts"
import { stableId } from "../../ids.ts"
import { defaultDataset, defaultIds } from "../default.ts"

/** Shared helpers for the `rich` dataset. Same org, people and clock as `default`. */

export const now = defaultDataset.now
export const orgId = defaultIds.orgId

/** A wall-clock time `days` before the dataset's `now` (UTC), e.g. `at(-1, "09:15")`. */
export const at = (days: number, time: string) => {
	const [hours, minutes] = time.split(":").map(Number)
	const date = new Date(now)
	date.setUTCDate(date.getUTCDate() + days)
	date.setUTCHours(hours!, minutes!, 0, 0)
	return date
}

/** Fixture image served by `backend/assets.ts`. Embed a size as `name-<w>x<h>.png`. */
export const asset = (path: string) => `${fixtureBackendUrl}/r2/${path}`

export type PersonKey = "ada" | "grace" | "alan" | "margaret" | "linus" | "katherine"
export type BotKey = "github" | "railway" | "openstatus"

export const userId = (key: PersonKey | BotKey) =>
	key === "katherine" || key === "github" || key === "railway" || key === "openstatus"
		? stableId(`rich:user:${key}`)
		: defaultIds.user(key)

export const channelKeys = [
	"launch",
	"launch-thread",
	"github",
	"deploys",
	"status",
	"links",
	"media",
	"long-reads",
	"standup",
	"announcements",
] as const
export type RichChannelKey = (typeof channelKeys)[number]
export const channelId = (key: RichChannelKey) => stableId(`rich:channel:${key}`)
export const messageId = (key: string) => stableId(`rich:message:${key}`)
export const memberId = (channel: RichChannelKey, person: PersonKey) =>
	stableId(`rich:channel-member:${channel}:${person}`)

export const message = (input: {
	readonly key: string
	readonly channel: RichChannelKey
	readonly author: PersonKey | BotKey
	readonly createdAt: Date
	readonly content: string
	readonly embeds?: ReadonlyArray<Record<string, unknown>>
	readonly replyTo?: string
	readonly thread?: RichChannelKey
	readonly editedAt?: Date
}): Row => ({
	id: messageId(input.key),
	channelId: channelId(input.channel),
	conversationId: null,
	authorId: userId(input.author),
	content: input.content,
	embeds: input.embeds ?? null,
	replyToMessageId: input.replyTo ? messageId(input.replyTo) : null,
	threadChannelId: input.thread ? channelId(input.thread) : null,
	createdAt: input.createdAt,
	updatedAt: input.editedAt ?? null,
	deletedAt: null,
})

export const reaction = (
	messageKey: string,
	channel: RichChannelKey,
	person: PersonKey,
	emoji: string,
): Row => ({
	id: stableId(`rich:reaction:${messageKey}:${person}:${emoji}`),
	messageId: messageId(messageKey),
	channelId: channelId(channel),
	conversationId: null,
	userId: userId(person),
	emoji,
	createdAt: at(0, "12:00"),
})
