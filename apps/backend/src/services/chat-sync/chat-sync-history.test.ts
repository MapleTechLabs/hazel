import type { ExternalChannelId, ExternalMessageId, ExternalThreadId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { withinCutoff } from "./chat-sync-history"
import type { ChatSyncInbound } from "./chat-sync-inbound"

const message = (id: string, sentAt: number, thread: string | null = null): ChatSyncInbound => {
	const event = {
		_tag: "MessageCreate" as const,
		externalMessageId: id as ExternalMessageId,
		externalWebhookId: null,
		content: id,
		externalReplyToMessageId: null,
		attachments: [],
		sentAt,
	}
	return {
		provider: "slack",
		externalWorkspaceIds: ["T1"],
		externalChannelId: "C1" as ExternalChannelId,
		dedupeKey: `slack:history:${id}`,
		author: null,
		event: thread === null ? event : { ...event, inExternalThreadId: thread as ExternalThreadId },
	}
}

const ids = (messages: ReadonlyArray<ChatSyncInbound>) =>
	messages.map((inbound) => (inbound.event as { externalMessageId: string }).externalMessageId)

describe("withinCutoff", () => {
	it("keeps everything without a cutoff", () => {
		const page = [message("a", 1), message("b", 2)]
		expect(withinCutoff(page, null)).toEqual({ messages: page, reachedCutoff: false })
	})

	it("drops older messages and says the cutoff was reached", () => {
		const result = withinCutoff([message("a", 5), message("b", 10), message("c", 15)], 10)
		expect(ids(result.messages)).toEqual(["b", "c"])
		expect(result.reachedCutoff).toBe(true)
	})

	it("drops a too-old parent's replies, even newer ones, but keeps a kept parent's", () => {
		const result = withinCutoff(
			[
				message("old", 5),
				message("old-reply", 20, "C1/old"),
				message("new", 12),
				message("new-reply", 13, "C1/new"),
			],
			10,
		)
		expect(ids(result.messages)).toEqual(["new", "new-reply"])
	})
})
