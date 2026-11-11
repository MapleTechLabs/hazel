import { MessageId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import { PageOutMessage } from "../../out-message"
import { PAGE_SIZE } from "../queries"
import type { ChatMessage } from "../rows"
import {
	adaMessageId,
	graceMessageId,
	loadedMessages,
	loadedModel,
	messages,
	updateWithShared,
} from "./fixtures.test-support"
import { AwaitJumpTarget, HighlightMessage, LocateMessage } from "./jump"
import { Message, type Model } from "./model"
import { MAX_WINDOW } from "./window"

/**
 * A reply's quote jumps to the message it quotes. Ada's message replies to Grace's, which is in the
 * window; `oldMessageId` is a message older than everything loaded.
 */

vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const channelId = loadedModel().channelId
const oldMessageId = Schema.decodeSync(MessageId)("00000000-0000-4000-8000-000000000999")
const loaded = (): Model => updateWithShared(loadedModel(), loadedMessages(messages)).model
const pressQuote = (messageId: MessageId) =>
	Message.ClickedReplyPreview({ fromMessageId: adaMessageId, messageId })

const oldMessage: ChatMessage = {
	...messages[1]!,
	id: oldMessageId,
	content: "The first plan",
	createdAtMs: Date.UTC(2026, 0, 1),
}

describe("a quoted message in the window", () => {
	test("the list scrolls to it, then it is highlighted", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(pressQuote(graceMessageId)),
			Command.expectExact(AwaitJumpTarget({ messageId: graceMessageId })),
			Command.resolve(AwaitJumpTarget, Message.RenderedJumpTarget({ messageId: graceMessageId })),
			Command.expectExact(HighlightMessage({ messageId: graceMessageId, scrollsPanel: false })),
			Command.resolve(HighlightMessage, Message.CompletedHighlightMessage()),
			model((current: Model) => expect(current.pendingJump).toBeNull()),
		)
	})
})

describe("a quoted message older than the window", () => {
	test("the history is paged in to it, the window grows over it, and its row is jumped to", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(pressQuote(oldMessageId)),
			model((current: Model) =>
				expect(current.pendingJump).toEqual({ messageId: oldMessageId, isLocated: false }),
			),
			Command.expectExact(LocateMessage({ channelId, messageId: oldMessageId })),
			Command.resolve(
				LocateMessage,
				Message.LocatedJumpTarget({ messageId: oldMessageId, newerCount: 100 }),
			),
			model((current: Model) => {
				expect(current.pendingJump).toEqual({ messageId: oldMessageId, isLocated: true })
				expect([current.offset, current.limit]).toEqual([0, 4 * PAGE_SIZE])
			}),
			message(loadedMessages([...messages, oldMessage])),
			Command.expectExact(AwaitJumpTarget({ messageId: oldMessageId })),
			Command.resolve(AwaitJumpTarget, Message.RenderedJumpTarget({ messageId: oldMessageId })),
			Command.resolve(HighlightMessage, Message.CompletedHighlightMessage()),
			model((current: Model) => expect(current.pendingJump).toBeNull()),
		)
	})

	// Loaded by id for the quote, it shows at the window's end with the messages between missing.
	test("its row arriving before the history reaches it does not jump yet", () => {
		story(
			updateWithShared,
			// `LocateMessage` is still running.
			given({ ...loaded(), pendingJump: { messageId: oldMessageId, isLocated: false } }),
			message(loadedMessages([...messages, oldMessage])),
			Command.expectNone(),
			model((current: Model) =>
				expect(current.pendingJump).toEqual({ messageId: oldMessageId, isLocated: false }),
			),
			message(Message.LocatedJumpTarget({ messageId: oldMessageId, newerCount: 2 })),
			Command.expectExact(AwaitJumpTarget({ messageId: oldMessageId })),
			Command.resolve(AwaitJumpTarget, Message.RenderedJumpTarget({ messageId: oldMessageId })),
			Command.resolve(HighlightMessage, Message.CompletedHighlightMessage()),
		)
	})

	test("past the largest window, the window slides so the message is in its middle", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(pressQuote(oldMessageId)),
			Command.resolve(
				LocateMessage,
				Message.LocatedJumpTarget({ messageId: oldMessageId, newerCount: 1000 }),
			),
			model((current: Model) => {
				expect([current.offset, current.limit]).toEqual([840, MAX_WINDOW])
				expect(current.list.canFollowEnd).toBe(false)
			}),
		)
	})

	test("a message that cannot be reached says so", () => {
		story(
			updateWithShared,
			given(loaded()),
			message(pressQuote(oldMessageId)),
			Command.resolve(LocateMessage, Message.FailedLocateJumpTarget({ messageId: oldMessageId })),
			model((current: Model) => expect(current.pendingJump).toBeNull()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Message not found",
						description: "This message may have been deleted.",
					},
				}),
			),
		)
	})
})
