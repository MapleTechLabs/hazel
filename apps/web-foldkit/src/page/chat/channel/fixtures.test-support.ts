import { ChannelId, ChannelMemberId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import type { Shared } from "../../contract"
import type { ChatMessage } from "../rows"
import { init, type Model, update } from "./page"
import type { Message } from "./model"

/** Fixtures for the channel page's write-path stories: Ada in #general with two messages. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

export const channelId = Schema.decodeSync(ChannelId)(uuid(1))
export const ada = Schema.decodeSync(UserId)(uuid(2))
export const grace = Schema.decodeSync(UserId)(uuid(3))
export const organizationId = Schema.decodeSync(OrganizationId)(uuid(4))
export const adaMemberId = Schema.decodeSync(ChannelMemberId)(uuid(5))
export const graceMessageId = Schema.decodeSync(MessageId)(uuid(1001))
export const adaMessageId = Schema.decodeSync(MessageId)(uuid(1002))

export const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: ada,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.sh",
		avatarUrl: null,
		isOnboarded: true,
		organizationId,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: null,
	nowMs: 0,
}

const chatMessage = (id: MessageId, authorId: UserId, content: string, minute: number): ChatMessage => ({
	id,
	channelId,
	authorId,
	content,
	embeds: null,
	hasEmbeds: false,
	replyToMessageId: null,
	threadChannelId: null,
	createdAtMs: Date.UTC(2026, 2, 12, 8, minute),
	updatedAtMs: null,
	isPinned: false,
	author: null,
})

/** Newest first, as the messages query returns them. */
export const messages: ReadonlyArray<ChatMessage> = [
	chatMessage(adaMessageId, ada, "Shipped the onboarding copy", 2),
	chatMessage(graceMessageId, grace, "Launch window confirmed", 1),
]

/** The page with the channel, its members and messages loaded. */
export const loadedModel = (): Model => {
	const base = init(channelId, ada)
	return {
		...base,
		channel: { id: channelId, name: "general", type: "public", icon: null, organizationId, parentChannelId: null },
		members: [
			{ id: adaMemberId, userId: ada, isHidden: false, createdAtMs: 0 },
			{ id: Schema.decodeSync(ChannelMemberId)(uuid(6)), userId: grace, isHidden: false, createdAtMs: 0 },
		],
		messages,
		hasLoadedMessages: true,
	}
}

/** `update` with the signed-in session, as `index.ts` calls it. */
export const updateWithShared = (model: Model, message: Message) => update(model, message, shared)
